import { hostReceipts } from '../data/receipts';
import { useI18n } from '../i18n';
import type { PlannedLine } from '../model/ledger';
import { convert, formatMoney } from '../model/money';
import type { BudgetSettings, Entry, Recurring } from '../model/types';
import { dayLabel, placeOf } from './format';
import { Icon, Tag } from './ui';

/** « 1 000,00 MAD » and, under it, « ≈ 92,00 € » when a rate exists; nothing invented when none does. */
function Amount({ cents, currency, settings }: { cents: number; currency: string; settings: BudgetSettings }) {
  const { lang } = useI18n();
  const base = settings.baseCurrency;
  const converted = currency === base ? null : convert(cents, currency, base, settings.rates);
  return (
    <span className="b-line-amount">
      {formatMoney(cents, currency, lang)}
      {converted !== null && <span className="b-sub">≈ {formatMoney(converted, base, lang)}</span>}
    </span>
  );
}

/** A paid line: the day, what it was, where, the amount, a pencil to correct it. */
export function PaidRow({ entry, settings, onEdit }: { entry: Entry; settings: BudgetSettings; onEdit: (entry: Entry) => void }) {
  const { t, lang } = useI18n();
  const place = placeOf(settings, entry.pocketId, entry.categoryId, t);
  return (
    <li className="b-line">
      <span className="b-line-day">{dayLabel(entry.day, lang)}</span>
      <span className="b-line-what">
        <span className="b-line-title">
          <span className="b-line-label">{entry.label ?? place.category?.name ?? place.pocket?.name ?? t('pocket.missing')}</span>
          {entry.review && <Tag tone="warn">{t('month.toReview')}</Tag>}
          {entry.recurringId && <Tag>{t('month.recurring')}</Tag>}
        </span>
        <span className="b-sub">{place.text}</span>
      </span>
      <Amount cents={entry.amountCents} currency={entry.currency} settings={settings} />
      <span className="b-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        {entry.receipt && <ReceiptButton path={entry.receipt} />}
        <button type="button" className="icon-btn round" aria-label={t('review.edit')} title={t('review.edit')} onClick={() => onEdit(entry)}><Icon name="edit" size={15} /></button>
      </span>
    </li>
  );
}

/** The photo a line was read from, opened in the system's own viewer (doc 177 §14). */
export function ReceiptButton({ path }: { path: string }) {
  const { t } = useI18n();
  return (
    <button type="button" className="icon-btn round" aria-label={t('receipt.open')} title={`${t('receipt.open')} · ${path}`}
      onClick={() => void hostReceipts.openInOS(path).catch((err: unknown) => console.warn('[mnemo-budget] receipt not opened:', err))}>
      <Icon name="receipt" size={15} />
    </button>
  );
}

/** A plan still to pay: the due day, what, where, the amount, « Payé » and a pencil. */
export function PlanRow({ line, settings, onPaid, onEdit }: { line: PlannedLine; settings: BudgetSettings; onPaid: (line: PlannedLine) => void; onEdit: (item: Entry | Recurring) => void }) {
  const { t, lang } = useI18n();
  const place = placeOf(settings, line.pocketId, line.categoryId, t);
  const item = line.entry ?? line.recurring;
  return (
    <li className="b-line planned">
      <span className="b-line-day">{line.wholeMonth ? t('month.wholeMonth') : dayLabel(line.day, lang)}</span>
      <span className="b-line-what">
        <span className="b-line-title">
          <span className="b-line-label">{line.label ?? place.category?.name ?? place.pocket?.name ?? t('pocket.missing')}</span>
          {line.overdue && <Tag tone="over">{t('month.overdue')}</Tag>}
          {line.recurring && <Tag>{t('month.recurring')}</Tag>}
          {line.review && <Tag tone="warn">{t('month.toReview')}</Tag>}
        </span>
        <span className="b-sub">{place.text}</span>
      </span>
      <Amount cents={line.amountCents} currency={line.currency} settings={settings} />
      <span className="b-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button type="button" className="small primary" onClick={() => onPaid(line)}><Icon name="check" size={14} /> {t('month.markPaid')}</button>
        {item && <button type="button" className="icon-btn round" aria-label={t('review.edit')} title={t('review.edit')} onClick={() => onEdit(item)}><Icon name="edit" size={15} /></button>}
      </span>
    </li>
  );
}
