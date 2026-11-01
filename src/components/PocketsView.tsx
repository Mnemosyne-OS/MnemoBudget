import { useState } from 'react';
import { useI18n } from '../i18n';
import type { MonthSummary, PlannedLine } from '../model/ledger';
import { formatMoney } from '../model/money';
import type { BudgetSettings, Entry, Recurring } from '../model/types';
import { AmountNotes } from './AmountNotes';
import { PocketTile } from './DashboardView';
import { amountsLabel } from './format';
import { PaidRow, PlanRow } from './LineRows';
import { CapBar, CardHead, Empty, FigureTile, Icon, ShareBar } from './ui';

interface Props {
  summary: MonthSummary;
  settings: BudgetSettings;
  pocketId: string | null;
  onPocket: (pocketId: string | null) => void;
  onEdit: (item: Entry | Recurring) => void;
  onPaid: (line: PlannedLine) => void;
  onSettings: () => void;
}

/**
 * The pockets as tiles; one opened shows its figures, its categories (a
 * click filters the lines), what is coming and what was paid.
 */
export function PocketsView({ summary, settings, pocketId, onPocket, onEdit, onPaid, onSettings }: Props) {
  const { t, lang } = useI18n();
  const base = settings.baseCurrency;
  const money = (cents: number) => formatMoney(cents, base, lang);
  const [categoryId, setCategoryId] = useState<string | null | undefined>(undefined);
  const open = pocketId ? summary.pockets.find((p) => p.pocket.id === pocketId) ?? null : null;

  if (!open) {
    return (
      <section className="glass b-card">
        <CardHead icon="pockets" title={t('month.pockets')} right={<button type="button" className="small" onClick={onSettings}><Icon name="plus" size={14} /> {t('settings.addPocket')}</button>} />
        {summary.pockets.length === 0 ? <Empty icon="pockets">{t('dash.noPockets')}</Empty> : (
          <div className="g-grid">
            {summary.pockets.map((p) => <PocketTile key={p.pocket.id} line={p} settings={settings} onOpen={() => onPocket(p.pocket.id)} />)}
          </div>
        )}
      </section>
    );
  }

  // `undefined` = every category; `null` = the lines with none.
  const inScope = <T extends { pocketId: string; categoryId?: string }>(list: T[]) => list.filter((l) => l.pocketId === open.pocket.id && (categoryId === undefined || (categoryId === null ? !l.categoryId : l.categoryId === categoryId)));
  const paid = inScope(summary.paid);
  const plans = inScope(summary.plannedLines);
  const remaining = open.capCents === undefined ? undefined : open.capCents - open.cappedSpentCents;
  const remainingAfter = open.capCents === undefined ? undefined : open.capCents - open.cappedSpentCents - open.cappedPlannedCents;
  const pickCategory = (id: string | null) => setCategoryId((current) => (current === id ? undefined : id));

  return (
    <>
      <div className="b-row">
        <button type="button" className="small" onClick={() => { onPocket(null); setCategoryId(undefined); }}><Icon name="back" size={14} /> {t('pocket.back')}</button>
        <span className="b-pocket-icon">{open.pocket.icon ?? '👛'}</span>
        <strong style={{ fontSize: 18 }}>{open.missing ? t('pocket.missing') : open.pocket.name}</strong>
      </div>

      <section className="b-figures" aria-label={t('month.spent')}>
        <FigureTile label={t('month.spent')} value={amountsLabel(open.spent, base, lang)} testId="figure-spent" notes={<AmountNotes amounts={open.spent} settings={settings} />} />
        <FigureTile label={t('month.planned')} value={amountsLabel(open.planned, base, lang)} testId="figure-planned" notes={<AmountNotes amounts={open.planned} settings={settings} />} />
        {remaining === undefined ? (
          <FigureTile label={t('month.remaining')} value={t('month.noCap')} tone="muted" testId="figure-remaining"
            notes={<button type="button" className="small" style={{ justifySelf: 'start' }} onClick={onSettings}><Icon name="settings" size={14} /> {t('dash.setCap')}</button>} />
        ) : (
          <FigureTile label={t('month.remaining')} value={`${open.remainingIsCeiling ? '≤ ' : ''}${money(remaining)}`} tone={remaining < 0 ? 'over' : undefined} testId="figure-remaining"
            notes={remainingAfter !== undefined && <span className="b-figure-note">{t('month.remainingAfter', { amount: `${open.remainingAfterIsCeiling ? '≤ ' : ''}${money(remainingAfter)}` })}</span>}>
            {open.capCents !== undefined && open.capCents > 0 && <CapBar spent={open.capCents - remaining} planned={remaining - (remainingAfter ?? remaining)} cap={open.capCents} />}
          </FigureTile>
        )}
      </section>

      <div className="b-pair">
        <section className="glass b-card">
          <CardHead icon="spark" title={t('pocket.categories')} right={categoryId !== undefined && <button type="button" className="small ghost" onClick={() => setCategoryId(undefined)}><Icon name="close" size={13} /> {t('lines.all')}</button>} />
          {open.categories.length === 0 ? <Empty>{t('pocket.noCategories')}</Empty> : (
            <div className="b-cats">
              {open.categories.map((c) => {
                const id = c.category?.id ?? null;
                const chosen = categoryId !== undefined && categoryId === id;
                return (
                  <div className={`b-cat tap${chosen ? ' chosen' : ''}`} key={c.category?.id ?? '_none'} role="button" tabIndex={0} aria-pressed={chosen}
                    onClick={() => pickCategory(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCategory(id); } }}>
                    <div className="b-cat-head">
                      <span className="b-cat-name">{c.category ? c.category.name : t('pocket.noCategory')}</span>
                      <span className="b-amount">{amountsLabel(c.spent, base, lang)}</span>
                      {c.category?.capCents !== undefined && <span className="b-sub">{t('pocket.capOf', { cap: money(c.category.capCents) })}</span>}
                    </div>
                    {c.category?.capCents !== undefined
                      ? <CapBar spent={c.spent.cents} planned={c.planned.cents} cap={c.category.capCents} thin />
                      : <ShareBar ratio={open.spent.cents > 0 ? c.spent.cents / open.spent.cents : 0} tone="muted" />}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="b-stack">
          <section className="glass b-card">
            <CardHead icon="repeat" title={t('month.upcoming')} />
            {plans.length === 0 ? <Empty icon="calendar">{t('month.emptyUpcoming')}</Empty> : (
              <ul className="b-lines">
                {plans.map((line) => <PlanRow key={line.key} line={line} settings={settings} onPaid={onPaid} onEdit={onEdit} />)}
              </ul>
            )}
          </section>
          <section className="glass b-card">
            <CardHead icon="lines" title={t('month.paidLines')} />
            {paid.length === 0 ? <Empty>{t('month.emptyPaid')}</Empty> : (
              <ul className="b-lines">
                {paid.map((e) => <PaidRow key={e.id} entry={e} settings={settings} onEdit={onEdit} />)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
