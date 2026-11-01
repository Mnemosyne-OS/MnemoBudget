import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { compareWithPreviousMonth, rankCategories, trend } from '../model/insights';
import { hasUnconverted, type MonthSummary, type PlannedLine, type PocketLine } from '../model/ledger';
import { formatMoney } from '../model/money';
import type { BudgetSettings, Day, Entry, Month, Recurring } from '../model/types';
import { AmountNotes } from './AmountNotes';
import { Ring, TrendBars } from './charts';
import { amountsLabel, monthLabel, percentLabel } from './format';
import { useCountUp } from './hooks';
import { PlanRow } from './LineRows';
import { CapBar, CardHead, Empty, Icon, ShareBar } from './ui';

interface Props {
  summary: MonthSummary;
  settings: BudgetSettings;
  entries: Entry[];
  recurring: Recurring[];
  month: Month;
  today: Day;
  onPocket: (pocketId: string) => void;
  onEdit: (item: Entry | Recurring) => void;
  onPaid: (line: PlannedLine) => void;
  onGo: (tab: 'lines' | 'review' | 'settings' | 'pockets') => void;
}

/** How many plans the dashboard lists before « +N »: the rest is in the history. */
const UPCOMING_SHOWN = 3;

/**
 * The month on ONE screen, no scrolling (field, 2026-10-26): three rows that
 * share the window's height. Top: what is left on the caps in large with its
 * arc, and the four figures beside it. Middle: the pockets as a strip. Bottom:
 * where the money goes, the last six months, what is coming. Every figure is
 * a sum the ledger made (doc 177 §3 rule 1). Below a height the bottom row
 * goes whole (a visible absence, never a card cut in half); the latest lines
 * and the per-currency totals live in the history.
 */
export function DashboardView({ summary, settings, entries, recurring, month, today, onPocket, onEdit, onPaid, onGo }: Props) {
  const { t, lang } = useI18n();
  const base = settings.baseCurrency;
  const money = (cents: number) => formatMoney(cents, base, lang);
  const compare = useMemo(() => compareWithPreviousMonth(settings, entries, month, today), [settings, entries, month, today]);
  const points = useMemo(() => trend(settings, entries, recurring, month, today, 6), [settings, entries, recurring, month, today]);
  const ranks = useMemo(() => rankCategories(summary, 5), [summary]);
  const reviewCount = summary.review.length + summary.reviewRecurring.length;
  const upcoming = summary.plannedLines.slice(0, UPCOMING_SHOWN);
  const moreUpcoming = summary.plannedLines.length - upcoming.length;

  const cap = summary.capCents;
  const hasCap = cap !== undefined && cap > 0;
  const remaining = summary.remainingCents;
  const remainingAfter = summary.remainingAfterPlannedCents;
  const spentOnCaps = hasCap && remaining !== undefined ? cap - remaining : 0;
  const ratio = hasCap ? spentOnCaps / cap : 0;
  const shown = useCountUp(remaining ?? 0);
  const over = remaining !== undefined && remaining < 0;

  return (
    <div className="b-dash">
      <section className="glass b-hero" aria-label={t('month.remaining')}>
        <div className="b-hero-text">
          <span className="b-hero-label">{t('month.remaining')} · {monthLabel(month, lang)}</span>
          {!hasCap || remaining === undefined ? (
            <>
              <span className="b-hero-value muted" data-testid="figure-remaining">{t('month.noCap')}</span>
              <span className="b-hero-note">
                <button type="button" className="small" onClick={() => onGo('settings')}><Icon name="settings" size={14} /> {t('dash.setCap')}</button>
              </span>
            </>
          ) : (
            <>
              <span className={`b-hero-value${over ? ' over' : ''}`} data-testid="figure-remaining">
                {summary.remainingIsCeiling ? '≤ ' : ''}{money(shown)}
              </span>
              <span className="b-hero-note">
                <span>{t('dash.ofCaps', { cap: money(cap) })}</span>
                {remainingAfter !== undefined && <span>{t('month.remainingAfter', { amount: `${summary.remainingAfterIsCeiling ? '≤ ' : ''}${money(remainingAfter)}` })}</span>}
              </span>
              <CapBar spent={spentOnCaps} planned={remaining - (remainingAfter ?? remaining)} cap={cap} />
            </>
          )}
        </div>
        {hasCap && (
          <div className="b-hero-ring">
            <Ring ratio={ratio} over={over} size={150} stroke={14} centre={`${Math.round(ratio * 100)} %`} label={t('dash.spentShare', { percent: Math.round(ratio * 100) })} />
          </div>
        )}
      </section>

      <section className="b-kpis" aria-label={t('month.spent')}>
        <div className="glass b-figure">
          <span className="b-figure-label">{t('month.spent')}</span>
          <span className="b-figure-value" data-testid="figure-spent">{amountsLabel(summary.spent, base, lang)}</span>
          <AmountNotes amounts={summary.spent} settings={settings} />
        </div>
        <div className="glass b-figure">
          <span className="b-figure-label">{t('month.planned')}</span>
          <span className="b-figure-value" data-testid="figure-planned">{amountsLabel(summary.planned, base, lang)}</span>
          <AmountNotes amounts={summary.planned} settings={settings} />
        </div>
        <div className="glass b-figure">
          <span className="b-figure-label">{monthLabel(compare.previousMonth, lang)}</span>
          <span className="b-figure-value">{amountsLabel(compare.previous, base, lang)}</span>
          <span className="b-figure-note b-row" style={{ gap: 8 }}>
            {compare.sameDay !== undefined && <span>{t('dash.untilDay', { day: compare.sameDay })}</span>}
            {compare.percent !== undefined && (
              <span className={`b-delta ${compare.percent > 0 ? 'up' : compare.percent < 0 ? 'down' : ''}`} title={t('dash.deltaTitle')}>
                <Icon name={compare.percent > 0 ? 'up' : compare.percent < 0 ? 'down' : 'swap'} size={12} />{percentLabel(compare.percent, lang)}
              </span>
            )}
          </span>
        </div>
        <button type="button" className={`glass b-figure tap${reviewCount ? ' attention' : ''}`} onClick={() => onGo('review')}>
          <span className="b-figure-label"><Icon name="review" size={14} /> {t('nav.review')}</span>
          <span className={`b-figure-value${reviewCount ? '' : ' ok'}`}>{reviewCount}</span>
          <span className="b-figure-note">{reviewCount ? t('dash.reviewGo') : t('review.empty')}</span>
        </button>
      </section>

      <section className="b-strip" aria-label={t('month.pockets')}>
        {summary.pockets.length === 0 ? (
          <button type="button" className="glass b-pocket b-pocket-add" onClick={() => onGo('settings')}><Icon name="plus" size={16} /> {t('settings.addPocket')}</button>
        ) : summary.pockets.map((p) => <PocketTile key={p.pocket.id} line={p} settings={settings} onOpen={() => onPocket(p.pocket.id)} compact />)}
      </section>

      <div className="b-dash-bottom">
        <section className="glass b-card b-fill">
          <CardHead icon="spark" title={t('dash.topCategories')} />
          <div className="b-card-body">
            {ranks.length === 0 ? <Empty>{t('month.emptyPaid')}</Empty> : (
              <div className="b-shares">
                {ranks.map((r) => {
                  const capC = r.category?.capCents;
                  const overCap = capC !== undefined && r.spent.cents > capC;
                  return (
                    <div className="b-share" key={`${r.pocket.id}|${r.category?.id ?? '_'}`}>
                      <div className="b-share-head">
                        <span className="b-share-name">{r.category?.name ?? t('pocket.noCategory')}<span className="b-sub">{r.pocket.name || t('pocket.missing')}</span></span>
                        <span className="b-amount">{amountsLabel(r.spent, base, lang)}</span>
                        {capC !== undefined ? <span className="b-sub">{t('pocket.capOf', { cap: money(capC) })}</span> : r.share !== undefined && <span className="b-sub">{Math.round(r.share * 100)} %</span>}
                      </div>
                      <ShareBar ratio={capC !== undefined ? r.spent.cents / capC : (r.share ?? 0)} tone={overCap ? 'over' : capC === undefined ? 'muted' : undefined} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="glass b-card b-fill">
          <CardHead icon="calendar" title={t('dash.trend')} />
          <div className="b-card-body b-trend-body">
            <TrendBars points={points} base={base} current={month} />
          </div>
        </section>

        <section className="glass b-card b-fill">
          <CardHead icon="repeat" title={t('month.upcoming')} right={moreUpcoming > 0 && <button type="button" className="small ghost" onClick={() => onGo('lines')}>+{moreUpcoming} <Icon name="next" size={14} /></button>} />
          <div className="b-card-body b-scroll">
            {upcoming.length === 0 ? <Empty icon="calendar">{t('month.emptyUpcoming')}</Empty> : (
              <ul className="b-lines">
                {upcoming.map((line) => <PlanRow key={line.key} line={line} settings={settings} onPaid={onPaid} onEdit={onEdit} />)}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** One pocket: its icon, name, what is spent, its cap bar, what is planned. `compact`: one line of the dashboard's strip. */
export function PocketTile({ line, settings, onOpen, chosen, compact }: { line: PocketLine; settings: BudgetSettings; onOpen: () => void; chosen?: boolean; compact?: boolean }) {
  const { t, lang } = useI18n();
  const base = settings.baseCurrency;
  const overCap = line.capCents !== undefined && line.cappedSpentCents > line.capCents;
  return (
    <button type="button" className={`glass b-pocket${chosen ? ' chosen' : ''}${compact ? ' compact' : ''}`} onClick={onOpen} aria-pressed={chosen}>
      <span className="b-pocket-head">
        <span className="b-pocket-icon">{line.pocket.icon ?? '👛'}</span>
        <span className="b-pocket-name">{line.missing ? t('pocket.missing') : line.pocket.name}</span>
        <span className={`b-pocket-amount${overCap ? ' over' : ''}`}>{amountsLabel(line.spent, base, lang)}</span>
      </span>
      {line.capCents !== undefined
        ? <CapBar spent={line.cappedSpentCents} planned={line.cappedPlannedCents} cap={line.capCents} thin={compact} />
        : <ShareBar ratio={line.spent.cents > 0 ? 1 : 0} tone="muted" />}
      <span className="b-pocket-foot b-sub">
        <span>{t('month.planned')} {amountsLabel(line.planned, base, lang)}</span>
        <span>{line.capCents !== undefined ? t('pocket.capOf', { cap: formatMoney(line.capCents, base, lang) }) : t('month.noCap')}</span>
      </span>
      {!compact && hasUnconverted(line.spent) && <span className="b-sub">{Object.entries(line.spent.unconverted).map(([c, u]) => `+ ${formatMoney(u.cents, c, lang)}`).join(' · ')}</span>}
    </button>
  );
}
