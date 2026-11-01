import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { formatMoney } from '../model/money';
import { repeatOf } from '../model/recurrence';
import type { BudgetSettings, Entry, Recurring } from '../model/types';
import { dayLabel, placeOf } from './format';
import { prefersReducedMotion } from './hooks';
import { ReceiptButton } from './LineRows';
import { CardHead, Empty, Icon, Tag } from './ui';

interface Props {
  entries: Entry[];
  recurring: Recurring[];
  settings: BudgetSettings;
  onConfirm: (item: Entry | Recurring) => void;
  onConfirmAll: () => void;
  onEdit: (item: Entry | Recurring) => void;
}

const LEAVE_MS = 260;

/**
 * « À vérifier »: what the orb wrote down (doc 177 §3 rule 2). What was heard
 * is not always what was said, so each line waits for a person's look, as a
 * card: one click confirms it (the card fades out first), « Corriger » opens it.
 */
export function ReviewView({ entries, recurring, settings, onConfirm, onConfirmAll, onEdit }: Props) {
  const { t, lang } = useI18n();
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  /** The confirmations waiting for their card to fade, by line id. */
  const pending = useRef(new Map<string, { item: Entry | Recurring; timer: number }>());
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  // Rule 10: a timer still pending when the view leaves is cleared, and the click it
  // carried is HONOURED: a « Valider » followed by a change of tab is not a cancel.
  useEffect(() => () => {
    for (const { item, timer } of pending.current.values()) {
      window.clearTimeout(timer);
      onConfirmRef.current(item);
    }
    pending.current.clear();
  }, []);

  const confirm = (item: Entry | Recurring) => {
    if (prefersReducedMotion()) return onConfirm(item);
    setLeaving((s) => new Set(s).add(item.id));
    const timer = window.setTimeout(() => {
      pending.current.delete(item.id);
      onConfirmRef.current(item);
    }, LEAVE_MS);
    pending.current.set(item.id, { item, timer });
  };
  const total = entries.length + recurring.length;

  const card = (item: Entry | Recurring) => {
    const isEntry = 'status' in item;
    const place = placeOf(settings, item.pocketId, item.categoryId, t);
    const day = isEntry ? item.day : item.start;
    return (
      <div className={`glass b-review-card${leaving.has(item.id) ? ' leaving' : ''}`} key={item.id}>
        <div className="b-row" style={{ justifyContent: 'space-between' }}>
          <span className="b-review-amount">{formatMoney(item.amountCents, item.currency, lang)}</span>
          {isEntry
            ? <Tag tone={item.status === 'paid' ? 'ok' : undefined}>{t(item.status === 'paid' ? 'review.paid' : 'review.planned')}</Tag>
            : <Tag><Icon name="repeat" size={11} /> {t(`entry.repeat.${repeatOf(item.rrule) ?? 'monthly'}`)}</Tag>}
        </div>
        <div className="b-review-where">
          <strong>{item.label ?? place.category?.name ?? place.pocket?.name ?? t('pocket.missing')}</strong>
          <span className="b-sub b-row" style={{ gap: 6 }}>
            {place.text} · {dayLabel(day, lang)}
            {isEntry && item.receipt && <><Tag>{t('receipt.tag')}</Tag><ReceiptButton path={item.receipt} /></>}
          </span>
        </div>
        <div className="b-review-actions">
          <button type="button" className="small" onClick={() => onEdit(item)}><Icon name="edit" size={14} /> {t('review.edit')}</button>
          <button type="button" className="small primary" onClick={() => confirm(item)} disabled={leaving.has(item.id)}><Icon name="check" size={14} /> {t('review.validate')}</button>
        </div>
      </div>
    );
  };

  return (
    <section className="glass b-card">
      <CardHead icon="review" title={<>{t('review.title')} {total > 0 && <span className="badge">{total}</span>}</>}
        right={total > 1 && <button type="button" className="small primary" onClick={onConfirmAll}><Icon name="check" size={14} /> {t('review.validateAll')}</button>} />
      <p className="b-sub" style={{ margin: 0 }}>{t('review.body')}</p>
      {total === 0 ? <Empty icon="check">{t('review.empty')}</Empty> : (
        <div className="b-review-grid">
          {entries.map(card)}
          {recurring.map(card)}
        </div>
      )}
    </section>
  );
}
