import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { byCurrency, searchLines, sumAmounts } from '../model/insights';
import type { MonthSummary, PlannedLine } from '../model/ledger';
import { formatMoney } from '../model/money';
import type { BudgetSettings, Entry, Recurring } from '../model/types';
import { amountsLabel } from './format';
import { PaidRow, PlanRow } from './LineRows';
import { CardHead, Empty, Icon, Tag } from './ui';

interface Props {
  summary: MonthSummary;
  settings: BudgetSettings;
  onEdit: (item: Entry | Recurring) => void;
  onPaid: (line: PlannedLine) => void;
}

type Kind = 'all' | 'paid' | 'planned' | 'review';
const KINDS: readonly Kind[] = ['all', 'paid', 'planned', 'review'];

/**
 * Every line of the month, paid and planned, newest first, with filters as
 * tiles (kind, pocket) and a search over the words. The totals beside the
 * count are the same sums the dashboard makes, over the lines shown: a line
 * with a rate is converted, one without is counted apart and the total reads
 * « ≥ » (doc 177 §3 rules 4 and 5); the other currencies are listed with
 * their own totals.
 */
export function LinesView({ summary, settings, onEdit, onPaid }: Props) {
  const { t, tc, lang } = useI18n();
  const base = settings.baseCurrency;
  const [kind, setKind] = useState<Kind>('all');
  const [pocketId, setPocketId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    type Row = { key: string; day: string; paid?: Entry; plan?: PlannedLine; review?: true; pocketId: string; categoryId?: string; label?: string };
    const all: Row[] = [
      ...summary.paid.map((e): Row => ({ key: e.id, day: e.day, paid: e, pocketId: e.pocketId, ...(e.categoryId ? { categoryId: e.categoryId } : {}), ...(e.label ? { label: e.label } : {}), ...(e.review ? { review: true as const } : {}) })),
      ...summary.plannedLines.map((l): Row => ({ key: l.key, day: l.day, plan: l, pocketId: l.pocketId, ...(l.categoryId ? { categoryId: l.categoryId } : {}), ...(l.label ? { label: l.label } : {}), ...(l.review ? { review: true as const } : {}) })),
    ];
    const kept = all.filter((r) => (kind === 'all' || (kind === 'paid' ? !!r.paid : kind === 'planned' ? !!r.plan : !!r.review)) && (!pocketId || r.pocketId === pocketId));
    return searchLines(kept, settings, query).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.key < b.key ? -1 : 1));
  }, [summary, settings, kind, pocketId, query]);

  const count = (k: Kind) => (k === 'all' ? summary.paid.length + summary.plannedLines.length : k === 'paid' ? summary.paid.length : k === 'planned' ? summary.plannedLines.length : summary.paid.filter((e) => e.review).length + summary.plannedLines.filter((l) => l.review).length);
  const pocketCount = (id: string) => summary.paid.filter((e) => e.pocketId === id).length + summary.plannedLines.filter((l) => l.pocketId === id).length;
  const spentShown = sumAmounts(settings, rows.flatMap((r) => (r.paid ? [r.paid] : [])));
  const plannedShown = sumAmounts(settings, rows.flatMap((r) => (r.plan ? [r.plan] : [])));
  const others = byCurrency(settings, rows.flatMap((r) => (r.paid ? [r.paid] : []))).filter((c) => c.currency !== base);

  return (
    <section className="glass b-card">
      <div className="b-filters">
        {KINDS.map((k) => (
          <button key={k} type="button" className={`chip-tile glass${kind === k ? ' chosen' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <strong>{t(`lines.${k}`)} <span className="b-sub">{count(k)}</span></strong>
          </button>
        ))}
        <label className="glass b-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('lines.search')} aria-label={t('lines.search')} />
          {query && <button type="button" className="icon-btn" aria-label={t('action.close')} onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}
        </label>
      </div>
      {settings.pockets.length > 1 && (
        <div className="b-filters">
          <button type="button" className={`chip-tile glass${pocketId === null ? ' chosen' : ''}`} aria-pressed={pocketId === null} onClick={() => setPocketId(null)}><strong>{t('lines.allPockets')}</strong></button>
          {settings.pockets.map((p) => (
            <button key={p.id} type="button" className={`chip-tile glass${pocketId === p.id ? ' chosen' : ''}`} aria-pressed={pocketId === p.id} onClick={() => setPocketId((c) => (c === p.id ? null : p.id))}>
              <strong>{p.icon} {p.name} <span className="b-sub">{pocketCount(p.id)}</span></strong>
            </button>
          ))}
        </div>
      )}
      <CardHead icon="lines" title={tc('lines.count', rows.length)} right={(
        <span className="b-sub">
          {t('month.spent')} {amountsLabel(spentShown, base, lang)} · {t('month.planned')} {amountsLabel(plannedShown, base, lang)}
          {others.map((c) => (
            <Tag key={c.currency} tone={c.baseCents === null ? 'warn' : undefined}>
              {formatMoney(c.cents, c.currency, lang)}{c.baseCents === null ? ` · ${t('dash.noRate')}` : ` ≈ ${formatMoney(c.baseCents, base, lang)}`}
            </Tag>
          ))}
        </span>
      )} />
      {rows.length === 0 ? <Empty icon="search">{t('lines.empty')}</Empty> : (
        <ul className="b-lines">
          {rows.map((r) => (r.paid
            ? <PaidRow key={r.key} entry={r.paid} settings={settings} onEdit={onEdit} />
            : <PlanRow key={r.key} line={r.plan!} settings={settings} onPaid={onPaid} onEdit={onEdit} />))}
        </ul>
      )}
    </section>
  );
}
