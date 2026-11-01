/**
 * The host's words for a failed reading, turned into the codes the receipts
 * dialog acts on (doc 177 §14.2). The sentence the host says for an image it
 * read nothing on is ALSO the one it says when no OCR engine is installed: both
 * are NO_TEXT, never a stop of the whole batch.
 */
import { describe, it, expect } from 'vitest';
import { extensionOf, readError, ReceiptError } from './receipts';

describe('readError', () => {
  it('the host sentence for an image without text, with or without an engine, is NO_TEXT', () => {
    const err = readError(new Error('No text found in image. Install an OCR engine in Settings → OCR to read images and scanned PDFs.'));
    expect(err.code).toBe('NO_TEXT');
  });

  it('a deep OCR that produced nothing is NO_TEXT too', () => {
    expect(readError(new Error('OCR produced no text — check the engine in Settings → OCR.')).code).toBe('NO_TEXT');
  });

  it('any other failure keeps its message under READ_FAILED', () => {
    const err = readError(new Error('ENOENT: no such file'));
    expect(err.code).toBe('READ_FAILED');
    expect(err.message).toContain('ENOENT');
  });

  it('a ReceiptError passes through unchanged', () => {
    const own = new ReceiptError('TOO_LARGE');
    expect(readError(own)).toBe(own);
  });
});

describe('extensionOf', () => {
  it('lower-cases the extension and gives nothing for a name without one', () => {
    expect(extensionOf('IMG_0001.HEIC')).toBe('heic');
    expect(extensionOf('ticket.final.PNG')).toBe('png');
    expect(extensionOf('ticket')).toBe('');
  });
});
