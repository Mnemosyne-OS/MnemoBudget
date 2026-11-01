import { useEffect, useRef, useState, type DragEvent } from 'react';
import { extensionOf, fileToBase64, RECEIPT_EXTENSIONS, ReceiptError, type ReceiptIO } from '../data/receipts';
import { useI18n } from '../i18n';
import { formatMoney } from '../model/money';
import { guessCategory, parseReceipt } from '../model/receipt';
import { newId } from '../model/records';
import type { BudgetSettings, Day, Entry } from '../model/types';
import { Icon } from './ui';

/** What a receipt's reading hands to the line dialog when it cannot be filed on its own. */
export interface ScanPrefill {
  amountCents?: number;
  currency?: string;
  day?: Day;
  label?: string;
  pocketId?: string;
  categoryId?: string;
  /** The photo's path, kept on the line. */
  receipt: string;
  /** Every amount read, for the hints when none names the total. */
  hints: number[];
  needsCategory: boolean;
  needsAmount: boolean;
  fileName: string;
}

type Source = { kind: 'file'; file: File } | { kind: 'path'; path: string };
type Outcome = { name: string; state: 'saved' | 'asked' | 'skipped' | 'failed'; detail?: string };

interface Props {
  settings: BudgetSettings;
  io: ReceiptIO;
  today: Day;
  /** A line read whole: written to « À vérifier ». */
  onSaveScan: (entry: Entry) => Promise<boolean>;
  /** A line the ticket does not fill: the person completes it in the line dialog; true when they saved it. */
  onNeedsForm: (prefill: ScanPrefill) => Promise<boolean>;
  onClose: () => void;
}

const nameOf = (s: Source) => (s.kind === 'file' ? s.file.name : s.path.split(/[\\/]/).pop() ?? s.path);

/**
 * Photos of till receipts, one or several (doc 177 §14): each is kept in the
 * app's folder, read by the host's local OCR, and parsed (model/receipt.ts).
 * A ticket that says its total, its day and names a category the person has
 * is written at once, to review (a reading is not a person's typing); one
 * that does not opens the line dialog with what was read and what is missing
 * said. Without an OCR engine the loop stops and Settings › OCR is offered.
 */
export function ReceiptDialog({ settings, io, today, onSaveScan, onNeedsForm, onClose }: Props) {
  const { t, tc, lang } = useI18n();
  const [busy, setBusy] = useState<{ n: number; total: number; name: string } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  /** A photo read empty: the host cannot tell "no engine" from "nothing read", so the banner offers Settings › OCR once. */
  const [emptyRead, setEmptyRead] = useState(false);
  const [over, setOver] = useState(false);
  /**
   * Asked before any photo: the host says whether an OCR engine is installed
   * (`reader.ocrStatus`). Missing → the question and Settings › OCR, no drop zone.
   * An older host cannot say ('unknown'): the reading says it, photo by photo.
   */
  const [engine, setEngine] = useState<'checking' | 'ready' | 'missing' | 'unknown'>('checking');
  const [recheck, setRecheck] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    let stale = false;
    const check = async () => {
      const installed = await io.ocrInstalled().catch((err: unknown) => { console.warn('[mnemo-budget] OCR status not read:', err); return null; });
      if (!stale && alive.current) setEngine(installed === null ? 'unknown' : installed ? 'ready' : 'missing');
    };
    void check();
    // Back from Settings › OCR, the window regains focus: asked again.
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => { stale = true; window.removeEventListener('focus', onFocus); };
  }, [io, recheck]);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const base = settings.baseCurrency;
  const place = (pocketId: string, categoryId?: string) => {
    const pocket = settings.pockets.find((p) => p.id === pocketId);
    const category = pocket?.categories.find((c) => c.id === categoryId);
    return category ? `${category.name} (${pocket?.name ?? ''})` : pocket?.name ?? '';
  };

  const readOne = async (source: Source): Promise<Outcome> => {
    const name = nameOf(source);
    const ext = extensionOf(name);
    if (!RECEIPT_EXTENSIONS.includes(ext)) return { name, state: 'failed', detail: t('receipt.badKind') };
    let path: string;
    if (source.kind === 'file') path = await io.saveImage(`${newId('t')}.${ext}`, await fileToBase64(source.file));
    else path = source.path;
    const text = await io.readText(path);
    const reading = parseReceipt(text, today);
    const guess = guessCategory(reading, settings);
    const filed = guess !== null && guess !== 'ambiguous' ? guess : null;
    if (reading.amountCents !== undefined && reading.day && filed) {
      const now = new Date().toISOString();
      const entry: Entry = {
        id: newId('e'), status: 'paid', amountCents: reading.amountCents, currency: reading.currency ?? base, day: reading.day,
        pocketId: filed.pocket.id, categoryId: filed.category.id, origin: 'scan', review: true, receipt: path, createdAt: now, updatedAt: now,
        ...(reading.merchant ? { label: reading.merchant } : {}),
      };
      const ok = await onSaveScan(entry);
      if (!ok) return { name, state: 'failed', detail: t('error.save', { reason: '' }).replace(/\s*:\s*$/, '') };
      return { name, state: 'saved', detail: t('receipt.saved', { amount: formatMoney(entry.amountCents, entry.currency, lang), label: entry.label ? ` ${entry.label}` : '', where: place(entry.pocketId, entry.categoryId) }) };
    }
    const prefill: ScanPrefill = {
      receipt: path, hints: reading.amountsSeen, fileName: name,
      needsCategory: !filed, needsAmount: reading.amountCents === undefined,
      ...(reading.amountCents !== undefined ? { amountCents: reading.amountCents } : {}),
      ...(reading.currency ? { currency: reading.currency } : {}),
      ...(reading.day ? { day: reading.day } : {}),
      ...(reading.merchant ? { label: reading.merchant } : {}),
      ...(filed ? { pocketId: filed.pocket.id, categoryId: filed.category.id } : {}),
    };
    const saved = await onNeedsForm(prefill);
    return saved ? { name, state: 'asked' } : { name, state: 'skipped' };
  };

  const run = async (sources: Source[]) => {
    if (!sources.length || busy) return;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!;
      if (!alive.current) return;
      setBusy({ n: i + 1, total: sources.length, name: nameOf(source) });
      let outcome: Outcome;
      try {
        outcome = await readOne(source);
      } catch (err) {
        const code = err instanceof ReceiptError ? err.code : 'READ_FAILED';
        console.warn('[mnemo-budget] receipt not read:', err);
        if (code === 'NO_TEXT' && alive.current) setEmptyRead(true);
        const reason = code === 'NO_TEXT' ? t('receipt.noText') : code === 'TOO_LARGE' ? t('receipt.tooLarge') : code === 'BAD_KIND' ? t('receipt.badKind') : (err instanceof Error ? err.message : String(err));
        outcome = { name: nameOf(source), state: 'failed', detail: reason };
      }
      if (alive.current) setOutcomes((o) => [...o, outcome]);
    }
    if (alive.current) setBusy(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    void run(files.map((file) => ({ kind: 'file', file })));
  };
  const pick = async () => {
    const path = await io.pickImage().catch((err: unknown) => { console.warn('[mnemo-budget] picker failed:', err); return null; });
    if (path) void run([{ kind: 'path', path }]);
  };

  const read = outcomes.filter((o) => o.state === 'saved' || o.state === 'asked').length;

  return (
    <div className="b-veil" onClick={() => { if (!busy) onClose(); }}>
      <div className="glass b-dialog" role="dialog" aria-modal="true" aria-label={t('receipt.title')} onClick={(e) => e.stopPropagation()}>
        <div className="b-dialog-head">
          <h2><Icon name="receipt" size={18} /> {t('receipt.title')}</h2>
          <button type="button" className="icon-btn round" aria-label={t('action.close')} title={t('action.close')} onClick={onClose} disabled={!!busy}><Icon name="close" size={16} /></button>
        </div>

        {engine === 'missing' && (
          <div className="b-banner warn b-engine-ask" role="status" data-testid="engine-ask">
            <div>
              <strong>{t('receipt.engineTitle')}</strong>
              <p className="b-sub" style={{ margin: '4px 0 0' }}>{t('receipt.engineBody')}</p>
            </div>
            <div className="b-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="primary" onClick={() => void io.openOcrSettings().catch((err: unknown) => console.warn('[mnemo-budget] settings not opened:', err))}>
                <Icon name="settings" size={14} /> {t('receipt.installOcr')}
              </button>
              <button type="button" onClick={() => setRecheck((n) => n + 1)}>{t('receipt.engineRecheck')}</button>
            </div>
          </div>
        )}

        {engine !== 'missing' && (
        <div className={`b-drop${over ? ' over' : ''}${busy ? ' busy' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} data-testid="receipt-drop">
          {busy ? (
            <>
              <div className="b-spinner" />
              <strong role="status">{t('receipt.reading', { n: busy.n, total: busy.total })}</strong>
              <span className="b-sub">{busy.name}</span>
              <span className="b-sub">{t('receipt.readingHint')}</span>
            </>
          ) : (
            <>
              <span className="b-empty-icon"><Icon name="receipt" size={22} /></span>
              <strong>{t('receipt.drop')}</strong>
              <span className="b-sub">{t('receipt.kinds')}</span>
              <button type="button" className="primary" onClick={() => void pick()}><Icon name="folder" size={15} /> {t('receipt.pick')}</button>
            </>
          )}
        </div>
        )}

        {emptyRead && (
          <div className="b-banner warn" role="alert">
            <span>{t('receipt.noEngine')}</span>
            <button type="button" className="small primary" onClick={() => void io.openOcrSettings().catch((err: unknown) => console.warn('[mnemo-budget] settings not opened:', err))}>
              <Icon name="settings" size={14} /> {t('receipt.installOcr')}
            </button>
          </div>
        )}

        {outcomes.length > 0 && (
          <ul className="b-scan-list" aria-label={tc('receipt.summary', read)}>
            {outcomes.map((o, i) => (
              <li key={`${o.name}-${i}`} className={`b-scan-row ${o.state}`}>
                <Icon name={o.state === 'saved' ? 'check' : o.state === 'asked' ? 'edit' : o.state === 'skipped' ? 'next' : 'warn'} size={14} />
                <span>
                  {o.state === 'saved' && o.detail}
                  {o.state === 'asked' && t('receipt.asked', { name: o.name })}
                  {o.state === 'skipped' && t('receipt.skipped', { name: o.name })}
                  {o.state === 'failed' && t('receipt.failed', { name: o.name, reason: o.detail ?? '' })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="b-actions">
          <span className="spacer b-sub">{outcomes.length > 0 && tc('receipt.summary', read)}</span>
          <button type="button" className="primary" onClick={onClose} disabled={!!busy}>{t('receipt.done')}</button>
        </div>
      </div>
    </div>
  );
}
