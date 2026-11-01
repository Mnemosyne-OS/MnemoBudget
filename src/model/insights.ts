/**
 * What the dashboard draws beyond the month's figures: the months before,
 * the same point of last month, the categories that weigh most, the
 * currencies the month was paid in (the history's header). Pure, and every number is a sum over the
 * lines (doc 177 §3 rule 1).
 *
 * 🎭 A comparison is only a percentage when it can be one: a previous month
 *    of zero, or a line without a rate on either side, gives the two amounts
 *    and no percentage. A month that holds a line without a rate carries that
 *    mark in the trend too (`≥`).
 */
import { addMonths, monthOf } from './dates';
import { emptyAmounts, hasUnconverted, monthSummary, type Amounts, type MonthSummary } from './ledger';
import { convert } from './money';
import type { BudgetSettings, Category, Currency, Day, Entry, Month, Pocket, Recurring } from './types';

export interface TrendPoint {
  month: Month;
  spent: Amounts;
  planned: Amounts;
}

/** The last `count` months up to `month` included, oldest first. */
export function trend(settings: BudgetSettings, entries: readonly Entry[], recurring: readonly Recurring[], month: Month, today: Day, count = 6): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    const s = monthSummary(settings, entries, recurring, m, today);
    out.push({ month: m, spent: s.spent, planned: s.planned });
  }
  return out;
}

function addTo(a: Amounts, e: { amountCents: number; currency: Currency }, settings: BudgetSettings) {
  const converted = convert(e.amountCents, e.currency, settings.baseCurrency, settings.rates);
  if (converted !== null) {
    a.cents += converted;
    if (e.currency !== settings.baseCurrency && !a.converted.includes(e.currency)) a.converted.push(e.currency);
    return;
  }
  const u = a.unconverted[e.currency] ?? { cents: 0, count: 0 };
  u.cents += e.amountCents;
  u.count += 1;
  a.unconverted[e.currency] = u;
}

/** What `lines` add up to in the base currency, the ones without a rate counted apart (the history's totals). */
export function sumAmounts(settings: BudgetSettings, lines: ReadonlyArray<{ amountCents: number; currency: Currency }>): Amounts {
  const a = emptyAmounts();
  for (const l of lines) addTo(a, l, settings);
  return a;
}

/** Paid between the 1st of `month` and its day `upToDay` included (a day past the month's end keeps the whole month). */
export function spentUntil(settings: BudgetSettings, entries: readonly Entry[], month: Month, upToDay: number): Amounts {
  const limit = `${month}-${String(upToDay).padStart(2, '0')}`;
  const a = emptyAmounts();
  for (const e of entries) {
    if (e.status !== 'paid' || monthOf(e.day) !== month || e.day > limit) continue;
    addTo(a, e, settings);
  }
  return a;
}

export interface Comparison {
  /** Spent this month so far (the whole month when it is a past one). */
  current: Amounts;
  /** Spent last month up to the same day of the month (the whole month when `month` is past). */
  previous: Amounts;
  previousMonth: Month;
  /** The day of the month both sides stop at; absent when both are whole months. */
  sameDay?: number;
  /** Change in %, only when `previous` is above zero and neither side left a line out. */
  percent?: number;
}

/**
 * This month against the same point of last month. For the current month
 * both sides stop at today's day of the month; for a past month both are
 * whole. A percentage is only given when it is honest (see the file's note):
 * 🎭 never for a month that has not begun, whose empty side would read as
 *    « −100 % » against any month before it (found by the verifier, 2026-10-26).
 */
export function compareWithPreviousMonth(settings: BudgetSettings, entries: readonly Entry[], month: Month, today: Day): Comparison {
  const previousMonth = addMonths(month, -1);
  const current = monthOf(today) === month;
  const sameDay = current ? Number(today.slice(8)) : 31;
  const cur = spentUntil(settings, entries, month, sameDay);
  const prev = spentUntil(settings, entries, previousMonth, sameDay);
  const out: Comparison = { current: cur, previous: prev, previousMonth, ...(current ? { sameDay } : {}) };
  const future = month > monthOf(today);
  if (!future && prev.cents > 0 && !hasUnconverted(cur) && !hasUnconverted(prev)) {
    out.percent = Math.round(((cur.cents - prev.cents) / prev.cents) * 100);
  }
  return out;
}

export interface CategoryRank {
  pocket: Pocket;
  /** Null: lines filed with no category (or in one that no longer exists). */
  category: Category | null;
  spent: Amounts;
  /** Share of the month's converted total, 0..1. Absent when that total, or this category's converted sum, is 0. */
  share?: number;
}

/** The categories that weigh most this month, heaviest first, at most `limit`; a category with nothing spent is not ranked. */
export function rankCategories(summary: MonthSummary, limit = 5): CategoryRank[] {
  const ranks: CategoryRank[] = [];
  for (const p of summary.pockets) {
    for (const c of p.categories) {
      if (c.spent.cents <= 0 && !hasUnconverted(c.spent)) continue;
      // 🎭 No share for a category whose only money has no rate: « 0 % » beside « ≥ 0,00 € » would be a figure nobody measured.
      ranks.push({ pocket: p.pocket, category: c.category, spent: c.spent, ...(summary.spent.cents > 0 && c.spent.cents > 0 ? { share: c.spent.cents / summary.spent.cents } : {}) });
    }
  }
  return ranks.sort((a, b) => b.spent.cents - a.spent.cents).slice(0, limit);
}

export interface CurrencyTotal {
  currency: Currency;
  /** In that currency's own cents. */
  cents: number;
  count: number;
  /** The same money in the base currency, or null when the person gave no rate. */
  baseCents: number | null;
}

/** What the month's paid lines add up to, currency by currency, the base first and then the heaviest. */
export function byCurrency(settings: BudgetSettings, paid: readonly Entry[]): CurrencyTotal[] {
  const totals = new Map<Currency, CurrencyTotal>();
  for (const e of paid) {
    const t = totals.get(e.currency) ?? { currency: e.currency, cents: 0, count: 0, baseCents: null };
    t.cents += e.amountCents;
    t.count += 1;
    totals.set(e.currency, t);
  }
  for (const t of totals.values()) t.baseCents = convert(t.cents, t.currency, settings.baseCurrency, settings.rates);
  return [...totals.values()].sort((a, b) => {
    if (a.currency === settings.baseCurrency) return -1;
    if (b.currency === settings.baseCurrency) return 1;
    return (b.baseCents ?? -1) - (a.baseCents ?? -1);
  });
}

/** The lines whose label, pocket or category contains `query` (accents and case folded), in the order given; all of them when it is empty. */
export function searchLines<T extends { label?: string; pocketId: string; categoryId?: string }>(lines: readonly T[], settings: BudgetSettings, query: string): T[] {
  const q = fold(query);
  if (!q) return [...lines];
  return lines.filter((l) => {
    const pocket = settings.pockets.find((p) => p.id === l.pocketId);
    const category = pocket?.categories.find((c) => c.id === l.categoryId);
    return [l.label, pocket?.name, category?.name].some((n) => n && fold(n).includes(q));
  });
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
