import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { currencyName, knownCurrencies } from '../model/currencies';
import { addDays, localDay } from '../model/dates';
import { convert, formatMoney, formatPlain, normalizeCurrency, parseAmount } from '../model/money';
import { newId } from '../model/records';
import { REPEATS, repeatOf, ruleFor, type Repeat } from '../model/recurrence';
import type { BudgetSettings, Category, Entry, Recurring } from '../model/types';
import { ConfirmDialog } from './ConfirmDialog';
import { CurrencyPicker, CurrencyTile } from './CurrencyPicker';
import { dayLabel } from './format';
import type { ScanPrefill } from './ReceiptDialog';
import { Icon } from './ui';

export type DialogTarget =
  /** `prefill`: what a receipt's photo said (doc 177 §14), with what it could not say marked. */
  | { kind: 'new'; status: 'paid' | 'planned'; pocketId?: string; prefill?: ScanPrefill }
  | { kind: 'entry'; entry: Entry }
  | { kind: 'recurring'; recurring: Recurring };

export interface DialogResult {
  settings?: BudgetSettings;
  entry?: Entry;
  recurring?: Recurring;
}

interface Props {
  target: DialogTarget;
  settings: BudgetSettings;
  onSave: (result: DialogResult) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}

const NEW_CATEGORY = '__new__';

/**
 * Write or correct one line by hand. A person's save takes the line off the
 * review list: they looked at it (doc 177 §3 rule 2). Deleting is here and
 * only here, behind the app's own confirmation (rule 6).
 *
 * The amount is written large, the currency chosen on a tile; a currency
 * other than the base shows what the line will count for, through the rate
 * the person typed, or says it will be counted apart when there is none.
 */
export function EntryDialog({ target, settings, onSave, onDelete, onClose }: Props) {
  const { t, lang } = useI18n();
  const today = localDay();
  const source = target.kind === 'entry' ? target.entry : target.kind === 'recurring' ? target.recurring : null;
  const scan = target.kind === 'new' ? target.prefill : undefined;
  const [status, setStatus] = useState<'paid' | 'planned'>(target.kind === 'new' ? target.status : target.kind === 'entry' ? target.entry.status : 'planned');
  const [amount, setAmount] = useState(source ? formatPlain(source.amountCents, lang) : scan?.amountCents !== undefined ? formatPlain(scan.amountCents, lang) : '');
  const [currency, setCurrency] = useState(source?.currency ?? scan?.currency ?? settings.baseCurrency);
  const [otherCurrency, setOtherCurrency] = useState(false);
  const [day, setDay] = useState(target.kind === 'entry' ? target.entry.day : target.kind === 'recurring' ? target.recurring.start : scan?.day ?? today);
  const [wholeMonth, setWholeMonth] = useState(target.kind === 'entry' && target.entry.wholeMonth === true);
  const [pocketId, setPocketId] = useState(source?.pocketId ?? scan?.pocketId ?? (target.kind === 'new' ? target.pocketId : undefined) ?? settings.pockets[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(source?.categoryId ?? scan?.categoryId ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [label, setLabel] = useState(source?.label ?? scan?.label ?? '');
  const [repeat, setRepeat] = useState<Repeat | 'none'>(target.kind === 'recurring' ? repeatOf(target.recurring.rrule) ?? 'monthly' : 'none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const pocket = settings.pockets.find((p) => p.id === pocketId);
  const base = settings.baseCurrency;
  const currencies = useMemo(() => knownCurrencies(settings, source?.currency), [settings, source?.currency]);
  const isRecurring = target.kind === 'recurring' || (target.kind === 'new' && status === 'planned' && repeat !== 'none');
  const cents = parseAmount(amount);
  const converted = cents !== null && currency !== base ? convert(cents, currency, base, settings.rates) : null;
  const rate = settings.rates[currency];

  // Escape closes, as a click on the veil does. While the deletion box is open, Escape is its own
  // (it listens too): one press closes the box, never the form under it.
  useEffect(() => {
    if (asking) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, asking]);

  const save = async () => {
    if (cents === null) return setError(t('entry.badAmount'));
    const code = normalizeCurrency(currency);
    if (!code) return setError(t('entry.badCurrency'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError(t('entry.badDay'));
    // Paid tomorrow is not paid: the same refusal as the agent door's (agent.ts, « say.paidInFuture »).
    if (status === 'paid' && !isRecurring && day > today) return setError(t('entry.futureDay'));
    if (!pocket) return setError(t('entry.noPocket'));
    let nextSettings: BudgetSettings | undefined;
    let category: Category | undefined = pocket.categories.find((c) => c.id === categoryId);
    if (categoryId === NEW_CATEGORY) {
      const name = newCategory.trim();
      if (name) {
        category = { id: newId('c'), name: name.slice(0, 80) };
        nextSettings = { ...settings, pockets: settings.pockets.map((p) => (p.id === pocket.id ? { ...p, categories: [...p.categories, category!] } : p)) };
      }
    }
    // A currency used for the first time joins the tiles offered next time.
    if (code !== base && !currencies.includes(code)) {
      nextSettings = { ...(nextSettings ?? settings), currencies: [...((nextSettings ?? settings).currencies ?? []), code] };
    }
    const now = new Date().toISOString();
    const common = {
      amountCents: cents, currency: code, pocketId: pocket.id,
      ...(category ? { categoryId: category.id } : {}),
      ...(label.trim() ? { label: label.trim().slice(0, 200) } : {}),
    };
    let result: DialogResult;
    if (isRecurring) {
      const prev = target.kind === 'recurring' ? target.recurring : null;
      const rec: Recurring = {
        id: prev?.id ?? newId('r'), origin: prev?.origin ?? 'typed', createdAt: prev?.createdAt ?? now, updatedAt: now,
        rrule: ruleFor(repeat === 'none' ? 'monthly' : repeat, day), start: day, ...common,
      };
      result = { recurring: rec };
    } else {
      const prev = target.kind === 'entry' ? target.entry : null;
      const entry: Entry = {
        // A line completed from a receipt stays a scan, with its photo (the person looked: not to review).
        id: prev?.id ?? newId('e'), status, day, origin: prev?.origin ?? (scan ? 'scan' : 'typed'), createdAt: prev?.createdAt ?? now, updatedAt: now,
        ...common,
        ...(status === 'planned' && wholeMonth ? { wholeMonth: true as const } : {}),
        ...(prev?.recurringId && prev.occurrence ? { recurringId: prev.recurringId, occurrence: prev.occurrence } : {}),
        ...(prev?.receipt ? { receipt: prev.receipt } : scan ? { receipt: scan.receipt } : {}),
      };
      result = { entry };
    }
    if (nextSettings) result.settings = nextSettings;
    setBusy(true);
    setError(null);
    const ok = await onSave(result);
    setBusy(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    const ok = await onDelete();
    setBusy(false);
    setAsking(false);
    if (ok) onClose();
  };

  const title = t(target.kind === 'new' ? 'entry.titleNew' : 'entry.titleEdit');
  const dayTile = (value: string, text: string) => (
    <button key={value} type="button" className={`chip-tile glass${day === value ? ' chosen' : ''}`} aria-pressed={day === value} onClick={() => setDay(value)}>{text}</button>
  );

  return (
    <div className="b-veil" onClick={onClose}>
      <div className="glass b-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="b-dialog-head">
          <h2>{title}</h2>
          {target.kind !== 'recurring' && (
            <div className="segmented glass" role="group" aria-label={t('entry.paid')}>
              {(['paid', 'planned'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{t(`entry.${s}`)}</button>
              ))}
            </div>
          )}
          <button type="button" className="icon-btn round" aria-label={t('action.close')} title={t('action.close')} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        {scan && (
          <div className="b-convert-note" data-testid="scan-note">
            <Icon name="receipt" size={15} />
            <span>
              {t('receipt.from', { name: scan.fileName })}
              {scan.needsAmount && <> · {t('receipt.needsAmount')}{scan.hints.length > 0 && ` ${t('receipt.amountsSeen', { amounts: scan.hints.map((c) => formatPlain(c, lang)).join(' · ') })}`}</>}
              {scan.needsCategory && <> · {t('receipt.needsCategory')}</>}
            </span>
          </div>
        )}

        <div className={`b-field${scan?.needsAmount ? ' attention' : ''}`}>
          <span>{t('entry.amount')}</span>
          <div className="b-amount-row">
            <input className="b-amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder={t('entry.amountHint')} aria-label={t('entry.amount')} />
            <span className="b-amount-cur" aria-hidden="true">{currency}</span>
          </div>
        </div>

        <div className="b-field">
          <span>{t('entry.currency')}</span>
          {otherCurrency ? (
            <CurrencyPicker value={currency} onChange={(code) => setCurrency(code)} exclude={[]} compact limit={10} startTyping />
          ) : (
            <div className="b-cur-tiles">
              {currencies.map((code) => <CurrencyTile key={code} code={code} compact chosen={currency === code} onPick={() => setCurrency(code)} />)}
              <button type="button" className="chip-tile glass b-cur-tile compact" onClick={() => setOtherCurrency(true)}>
                <span className="b-cur-symbol" aria-hidden="true"><Icon name="plus" size={14} /></span>
                <strong>{t('currency.other')}</strong>
              </button>
            </div>
          )}
          {currency !== base && (converted !== null && rate ? (
            <span className="b-convert-note"><Icon name="coins" size={15} /><span>{t('entry.converts', { amount: formatMoney(converted, base, lang), currency: currencyName(currency, lang), day: dayLabel(rate.day, lang) })}</span></span>
          ) : (
            <span className="b-convert-note warn"><Icon name="warn" size={15} /><span>{t('entry.noRate', { currency })}</span></span>
          ))}
        </div>

        {status === 'paid' && !isRecurring ? (
          <div className="b-field">
            <span>{t('entry.day')}</span>
            <div className="b-day-tiles">
              {dayTile(today, t('entry.today'))}
              {dayTile(addDays(today, -1), t('entry.yesterday'))}
              <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-label={t('entry.day')} />
            </div>
          </div>
        ) : (
          <div className="b-row end">
            <label className="b-field">
              <span>{t('entry.dueDay')}</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            {status === 'planned' && !isRecurring && (
              <label className="b-switch" style={{ paddingBottom: 10 }}>
                <input type="checkbox" checked={wholeMonth} onChange={(e) => setWholeMonth(e.target.checked)} />
                <span>{t('entry.wholeMonth')}</span>
              </label>
            )}
          </div>
        )}

        {((status === 'planned' && target.kind === 'new') || target.kind === 'recurring') && (
          <div className="b-field">
            <span>{t('entry.repeat')}</span>
            <div className="b-tiles">
              {(target.kind === 'recurring' ? REPEATS : (['none', ...REPEATS] as const)).map((r) => (
                <button key={r} type="button" className={`chip-tile glass${repeat === r ? ' chosen' : ''}`} aria-pressed={repeat === r} onClick={() => setRepeat(r)}>
                  <Icon name={r === 'none' ? 'calendar' : 'repeat'} size={14} /> {t(`entry.repeat.${r}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="b-field">
          <span>{t('entry.pocket')}</span>
          <div className="b-tiles">
            {settings.pockets.map((p) => (
              <button key={p.id} type="button" className={`chip-tile glass${pocketId === p.id ? ' chosen' : ''}`} aria-pressed={pocketId === p.id}
                onClick={() => { setPocketId(p.id); if (!p.categories.some((c) => c.id === categoryId)) setCategoryId(''); }}>
                {p.icon} {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className={`b-field${scan?.needsCategory ? ' attention' : ''}`}>
          <span>{t('entry.category')}</span>
          <div className="b-tiles">
            <button type="button" className={`chip-tile glass${categoryId === '' ? ' chosen' : ''}`} aria-pressed={categoryId === ''} onClick={() => setCategoryId('')}>{t('entry.noCategory')}</button>
            {pocket?.categories.map((c) => (
              <button key={c.id} type="button" className={`chip-tile glass${categoryId === c.id ? ' chosen' : ''}`} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</button>
            ))}
            <button type="button" className={`chip-tile glass${categoryId === NEW_CATEGORY ? ' chosen' : ''}`} aria-pressed={categoryId === NEW_CATEGORY} onClick={() => setCategoryId(NEW_CATEGORY)}><Icon name="plus" size={13} /> {t('entry.newCategory')}</button>
          </div>
          {categoryId === NEW_CATEGORY && (
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={80} placeholder={t('entry.newCategoryName')} aria-label={t('entry.newCategoryName')} autoFocus />
          )}
        </div>

        <label className="b-field">
          <span>{t('entry.label')}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('entry.labelHint')} maxLength={200} />
        </label>

        {error && <p className="b-error" role="alert">{error}</p>}

        <div className="b-actions">
          {onDelete && <button type="button" className="danger spacer" onClick={() => setAsking(true)} disabled={busy}><Icon name="trash" size={14} /> {t('entry.delete')}</button>}
          <button type="button" onClick={onClose} disabled={busy}>{t('entry.cancel')}</button>
          <button type="button" className="primary" onClick={save} disabled={busy}><Icon name="check" size={15} /> {t('entry.save')}</button>
        </div>
      </div>
      {asking && (
        <ConfirmDialog title={t('entry.delete')} confirmLabel={t('entry.delete')} danger busy={busy} onConfirm={() => void remove()} onClose={() => setAsking(false)}>
          <p style={{ margin: 0 }}>{t('entry.deleteConfirm')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
