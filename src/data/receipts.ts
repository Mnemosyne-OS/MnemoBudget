/**
 * What reading a till receipt asks of the host (doc 177 §14), behind one
 * interface so the screens are tested without a host:
 *
 *  - the photo comes from the OS picker (`dialog.selectFile`) or is dropped
 *    on the window and kept as bytes in the app's own folder
 *    (`dialog.writeAppBytes`, doc 179 §12: `receipts/<id>.jpg`, never over an
 *    existing file);
 *  - the text comes from the host's local OCR engine through
 *    `reader.extractDocument` with `forceOcr` (an image has no text layer:
 *    the host OCRs it, on this machine, no credit spent). Without an engine
 *    the host says so, and the screen offers Settings › OCR.
 *
 * Deadline: a cold OCR sidecar warms for up to three minutes (ocrLocal.ts),
 * so the read carries its own long budget, not the 15 s of a file call.
 */
import { sdk } from './host';

/** Image kinds the host OCRs and keeps (OCR_SUPPORTED_EXTS ∩ APP_BYTE_EXTENSIONS). A HEIC is refused by name. */
export const RECEIPT_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp'];

/** The read's budget: a warming sidecar, then pages. */
export const OCR_READ_TIMEOUT_MS = 180_000;
const BYTES_TIMEOUT_MS = 60_000;

export class ReceiptError extends Error {
  constructor(public readonly code: 'NO_TEXT' | 'BAD_KIND' | 'TOO_LARGE' | 'READ_FAILED' | 'SAVE_FAILED', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ReceiptError';
  }
}

export interface ReceiptIO {
  /** The OS picker, images only. Null when the person closed it. */
  pickImage(): Promise<string | null>;
  /** Keeps a dropped photo in the app's folder; answers its absolute path. */
  saveImage(name: string, base64: string): Promise<string>;
  /** The text the OCR engine read off the photo. Throws ReceiptError. */
  readText(path: string): Promise<string>;
  /** Settings › OCR, where an engine is installed. Only from a click. */
  /** Is an OCR engine installed? `null` when the host cannot say (an older host without `reader.ocrStatus`). */
  ocrInstalled(): Promise<boolean | null>;
  openOcrSettings(): Promise<void>;
  /** The photo, in the system's own viewer. */
  openInOS(path: string): Promise<void>;
}

/** The extension of a file name, lower case, without the dot; '' when none. */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** The host's own wording for a reading that failed (lib/documentExtract.ts), turned into a code. */
export function readError(err: unknown): ReceiptError {
  if (err instanceof ReceiptError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // The host says the same sentence for "no OCR engine installed" and for "the engine read
  // nothing on this image" (documentExtract.ts, IMAGE_EXTS branch): one code, the photo is
  // said unread and the dialog points at Settings › OCR in case the engine is the cause.
  if (/install an ocr engine|no text found|ocr produced no text/i.test(message)) return new ReceiptError('NO_TEXT', message);
  return new ReceiptError('READ_FAILED', message);
}

export const hostReceipts: ReceiptIO = {
  async pickImage() {
    const picked = await sdk.selectFile([{ name: 'Photos', extensions: [...RECEIPT_EXTENSIONS] }]);
    return typeof picked === 'string' && picked ? picked : null;
  },
  async saveImage(name, base64) {
    const res = await sdk.invoke<{ path?: unknown }>('dialog.writeAppBytes', { rel: `receipts/${name}`, base64 }, BYTES_TIMEOUT_MS).catch((err: unknown) => {
      throw new ReceiptError('SAVE_FAILED', err instanceof Error ? err.message : String(err));
    });
    if (typeof res?.path !== 'string' || !res.path) throw new ReceiptError('SAVE_FAILED', 'no path answered');
    return res.path;
  },
  async readText(path) {
    const res = await sdk.invoke<{ text?: unknown }>('reader.extractDocument', { filePath: path, forceOcr: true }, OCR_READ_TIMEOUT_MS).catch((err: unknown) => {
      throw readError(err);
    });
    const text = typeof res?.text === 'string' ? res.text.trim() : '';
    if (!text) throw new ReceiptError('NO_TEXT');
    return text;
  },
  async ocrInstalled() {
    try {
      const res = await sdk.invoke<{ installed?: unknown }>('reader.ocrStatus', undefined, 15_000);
      return typeof res?.installed === 'boolean' ? res.installed : null;
    } catch (err) {
      // An older host has no such door: the question is not asked, the reading says it.
      if (!/UNKNOWN_ACTION/i.test(err instanceof Error ? err.message : String(err))) console.warn('[mnemo-budget] OCR status not read:', err);
      return null;
    }
  },
  async openOcrSettings() {
    await sdk.invoke('settings.open', { page: 'ocr' }, 15_000);
  },
  async openInOS(path) {
    const res = await sdk.openInOS(path);
    if (res && res.success === false) throw new Error(res.error ?? 'OPEN_FAILED');
  },
};

/** A dropped file as base64, with the budget of the app's byte door (50 MB). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 50 * 1024 * 1024) return reject(new ReceiptError('TOO_LARGE'));
    const reader = new FileReader();
    reader.onerror = () => reject(new ReceiptError('READ_FAILED', 'the file could not be read'));
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}
