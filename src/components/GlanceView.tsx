import { useI18n } from '../i18n';
import type { MonthSummary } from '../model/ledger';
import { formatMoney } from '../model/money';
import type { BudgetSettings } from '../model/types';
import { Ring } from './charts';
import { amountsLabel, monthLabel } from './format';
import { useCountUp } from './hooks';
import { Icon } from './ui';

interface Props {
  summary: MonthSummary;
  settings: BudgetSettings;
  /** `far`: the board is zoomed out (doc 59 §6). `mini`: the window is small. */
  mode: 'far' | 'mini';
  onAdd?: () => void;
}

/**
 * One thing to read from across the board, or in a small window: what is
 * left on the budgets this month (spent, when no cap is set), the spent and
 * planned under it, and the lines waiting for a look. Sized in container
 * units, so it follows the WINDOW the person gave it, never the text scale.
 * Nothing here does anything the host does not: the orb is the host's.
 */
export function GlanceView({ summary, settings, mode, onAdd }: Props) {
  const { t, tc, lang } = useI18n();
  const base = settings.baseCurrency;
  const cap = summary.capCents;
  const hasCap = cap !== undefined && cap > 0 && summary.remainingCents !== undefined;
  const remaining = summary.remainingCents ?? 0;
  const shown = useCountUp(hasCap ? remaining : summary.spent.cents);
  const over = hasCap && remaining < 0;
  const ratio = hasCap ? (cap - remaining) / cap : 0;
  const review = summary.review.length + summary.reviewRecurring.length;
  const floor = hasCap ? (summary.remainingIsCeiling ? '≤ ' : '') : (Object.keys(summary.spent.unconverted).length ? '≥ ' : '');

  return (
    <div className={`b-glance ${mode}`} data-testid={`glance-${mode}`}>
      <div className="b-glance-main">
        <span className="b-glance-label">{hasCap ? t('month.remaining') : t('month.spent')} · {monthLabel(summary.month, lang)}</span>
        <span className={`b-glance-value${over ? ' over' : ''}`} data-testid="glance-figure">{floor}{formatMoney(shown, base, lang)}</span>
        <span className="b-glance-sub">
          {hasCap
            ? <><span>{t('month.spent')} {amountsLabel(summary.spent, base, lang)}</span><span>{t('month.planned')} {amountsLabel(summary.planned, base, lang)}</span></>
            : <><span>{t('month.planned')} {amountsLabel(summary.planned, base, lang)}</span><span>{t('month.noCap')}</span></>}
        </span>
        {review > 0 && <span className="b-glance-review"><Icon name="review" size={16} /> {tc('say.review', review)}</span>}
      </div>
      {hasCap && mode === 'far' && (
        <div className="b-glance-ring">
          <Ring ratio={ratio} over={over} size={200} stroke={18} centre={`${Math.round(ratio * 100)} %`} label={t('dash.spentShare', { percent: Math.round(ratio * 100) })} />
        </div>
      )}
      {mode === 'mini' && onAdd && (
        <button type="button" className="primary b-glance-add" aria-label={t('action.add')} title={t('action.add')} onClick={onAdd}><Icon name="plus" size={22} /></button>
      )}
    </div>
  );
}
