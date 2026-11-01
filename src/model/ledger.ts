/**
 * The month's figures (doc 177 §3). 🚨 Rule 1: every total here is a SUM over
 * the files, never a model's answer. The orb speaks a sentence built from
 * these numbers (agentSay), and the screen draws the same ones.
 *
 * 🎭 A line in a currency the person gave no rate for is NOT in the base
 *    total: it is counted apart (`unconverted`), and the total then reads as
 *    a floor (`≥`). A cap nobody set is absent, never « 0 left ».
 */
import { monthOf, monthRange } from './dates';
import { convert } from './money';
import { occurrencesBetween } from './recurrence';
import type { BudgetSettings, Category, Currency, Day, Entry, Month, Pocket, Recurring } from './types';

export interface Amounts {
  /** Base-currency cents of every line that could be converted. */
  cents: number;
  /** Lines left out of `cents`: per currency, their own cents and how many. */
  unconverted: Record<Currency, { cents: number; count: number }>;
  /** Currencies other than the base that ARE in `cents`, through the rate the person typed (said with the total, doc 177 §3 rule 4). */
  converted: Currency[];
}

export const emptyAmounts = (): Amounts => ({ cents: 0, unconverted: {}, converted: [] });

export function hasUnconverted(a: Amounts): boolean {
  return Object.keys(a.unconverted).length > 0;
}

function addTo(a: Amounts, cents: number, currency: Currency, settings: BudgetSettings) {
  const converted = convert(cents, currency, settings.baseCurrency, settings.rates);
  if (converted !== null) {
    a.cents += converted;
    if (currency !== settings.baseCurrency && !a.converted.includes(currency)) a.converted.push(currency);
    return;
  }
  const u = a.unconverted[currency] ?? { cents: 0, count: 0 };
  u.cents += cents;
  u.count += 1;
  a.unconverted[currency] = u;
}

/** A plan still to pay: a planned entry, or one occurrence of a recurring line that no paid entry answers. */
export interface PlannedLine {
  key: string;
  day: Day;
  wholeMonth?: true;
  amountCents: number;
  currency: Currency;
  pocketId: string;
  categoryId?: string;
  label?: string;
  /** Due before today and not paid. */
  overdue: boolean;
  review?: true;
  entry?: Entry;
  recurring?: Recurring;
}

export interface CategoryLine {
  /** Null: lines filed in the pocket with no category, or in a category that no longer exists. */
  category: Category | null;
  spent: Amounts;
  planned: Amounts;
}

export interface PocketLine {
  pocket: Pocket;
  /** The pocket was removed from the settings while lines still name it. */
  missing?: true;
  spent: Amounts;
  planned: Amounts;
  categories: CategoryLine[];
  /** Sum of the caps that are set; absent when none is. */
  capCents?: number;
  /** Spent in the categories that HAVE a cap: the only spending a cap can be compared to. */
  cappedSpentCents: number;
  cappedPlannedCents: number;
  /** A capped category's SPENT lines hold one without a rate: what is left is at most cap − spent (« ≤ »). */
  remainingIsCeiling?: true;
  /** The same for « after what is planned », where planned lines count too. */
  remainingAfterIsCeiling?: true;
}

export interface MonthSummary {
  month: Month;
  pockets: PocketLine[];
  spent: Amounts;
  planned: Amounts;
  capCents?: number;
  /** Caps minus what was spent in their categories. Absent when no cap is set. Can be negative. */
  remainingCents?: number;
  /** The same, once the plans of those categories are paid too. */
  remainingAfterPlannedCents?: number;
  /**
   * A capped category's SPENT lines hold one with no rate: what is left is at
   * most `remainingCents` (« ≤ »). A plan without a rate never makes it a
   * ceiling: `remainingCents` does not count plans (verifier, 2026-10-24).
   */
  remainingIsCeiling?: true;
  /** `remainingAfterPlannedCents` is a ceiling: a capped category's spent OR planned lines hold one with no rate. */
  remainingAfterIsCeiling?: true;
  /** Paid lines of the month, newest first. */
  paid: Entry[];
  plannedLines: PlannedLine[];
  /** Every line still waiting for review, whatever its month. */
  review: Entry[];
  reviewRecurring: Recurring[];
}

/** Every plan due in `month` (and, for the current month, the plans left unpaid before it). */
export function plannedLines(entries: readonly Entry[], recurring: readonly Recurring[], month: Month, today: Day): PlannedLine[] {
  const { first, last } = monthRange(month);
  const current = monthOf(today) === month;
  const isOverdue = (day: Day, whole?: true) => (whole ? monthOf(day) < monthOf(today) : day < today);
  const out: PlannedLine[] = [];
  for (const e of entries) {
    if (e.status !== 'planned') continue;
    const inMonth = monthOf(e.day) === month;
    const leftBefore = current && e.day < first;
    if (!inMonth && !leftBefore) continue;
    out.push({
      key: e.id, day: e.day, amountCents: e.amountCents, currency: e.currency, pocketId: e.pocketId, overdue: isOverdue(e.day, e.wholeMonth), entry: e,
      ...(e.wholeMonth ? { wholeMonth: true as const } : {}),
      ...(e.categoryId ? { categoryId: e.categoryId } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.review ? { review: true as const } : {}),
    });
  }
  const paidOccurrences = new Set(entries.filter((e) => e.recurringId && e.occurrence).map((e) => `${e.recurringId}|${e.occurrence}`));
  for (const r of recurring) {
    for (const day of occurrencesBetween(r, first, last)) {
      if (paidOccurrences.has(`${r.id}|${day}`)) continue;
      out.push({
        key: `${r.id}|${day}`, day, amountCents: r.amountCents, currency: r.currency, pocketId: r.pocketId, overdue: isOverdue(day), recurring: r,
        ...(r.categoryId ? { categoryId: r.categoryId } : {}),
        ...(r.label ? { label: r.label } : {}),
        ...(r.review ? { review: true as const } : {}),
      });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : 1));
}

export function monthSummary(settings: BudgetSettings, entries: readonly Entry[], recurring: readonly Recurring[], month: Month, today: Day): MonthSummary {
  const paid = entries.filter((e) => e.status === 'paid' && monthOf(e.day) === month)
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  const plans = plannedLines(entries, recurring, month, today);

  const lines = new Map<string, PocketLine>();
  const pocketLine = (pocketId: string): PocketLine => {
    let line = lines.get(pocketId);
    if (!line) {
      const pocket = settings.pockets.find((p) => p.id === pocketId);
      line = {
        pocket: pocket ?? { id: pocketId, name: '', categories: [] },
        ...(pocket ? {} : { missing: true as const }),
        spent: emptyAmounts(), planned: emptyAmounts(), categories: [], cappedSpentCents: 0, cappedPlannedCents: 0,
      };
      if (pocket) line.categories = pocket.categories.map((c) => ({ category: c, spent: emptyAmounts(), planned: emptyAmounts() }));
      lines.set(pocketId, line);
    }
    return line;
  };
  for (const p of settings.pockets) pocketLine(p.id);

  const categoryLine = (line: PocketLine, categoryId: string | undefined): CategoryLine => {
    const known = categoryId ? line.categories.find((c) => c.category?.id === categoryId) : undefined;
    if (known) return known;
    let loose = line.categories.find((c) => c.category === null);
    if (!loose) {
      loose = { category: null, spent: emptyAmounts(), planned: emptyAmounts() };
      line.categories.push(loose);
    }
    return loose;
  };

  const spent = emptyAmounts();
  const planned = emptyAmounts();
  const book = (kind: 'spent' | 'planned', cents: number, currency: Currency, pocketId: string, categoryId?: string) => {
    const line = pocketLine(pocketId);
    const cat = categoryLine(line, categoryId);
    addTo(kind === 'spent' ? spent : planned, cents, currency, settings);
    addTo(line[kind], cents, currency, settings);
    addTo(cat[kind], cents, currency, settings);
  };
  for (const e of paid) book('spent', e.amountCents, e.currency, e.pocketId, e.categoryId);
  for (const p of plans) book('planned', p.amountCents, p.currency, p.pocketId, p.categoryId);

  let anyCap = false;
  let capTotal = 0;
  let cappedSpent = 0;
  let cappedPlanned = 0;
  let ceiling = false;
  let ceilingAfter = false;
  for (const line of lines.values()) {
    for (const c of line.categories) {
      if (c.category?.capCents === undefined) continue;
      anyCap = true;
      if (hasUnconverted(c.spent)) {
        ceiling = true;
        line.remainingIsCeiling = true;
      }
      if (hasUnconverted(c.spent) || hasUnconverted(c.planned)) {
        ceilingAfter = true;
        line.remainingAfterIsCeiling = true;
      }
      line.capCents = (line.capCents ?? 0) + c.category.capCents;
      line.cappedSpentCents += c.spent.cents;
      line.cappedPlannedCents += c.planned.cents;
    }
    if (line.capCents !== undefined) {
      capTotal += line.capCents;
      cappedSpent += line.cappedSpentCents;
      cappedPlanned += line.cappedPlannedCents;
    }
  }

  const summary: MonthSummary = {
    month,
    pockets: [...lines.values()],
    spent,
    planned,
    paid,
    plannedLines: plans,
    review: entries.filter((e) => e.review).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    reviewRecurring: recurring.filter((r) => r.review),
  };
  if (anyCap) {
    summary.capCents = capTotal;
    summary.remainingCents = capTotal - cappedSpent;
    summary.remainingAfterPlannedCents = capTotal - cappedSpent - cappedPlanned;
    if (ceiling) summary.remainingIsCeiling = true;
    if (ceilingAfter) summary.remainingAfterIsCeiling = true;
  }
  return summary;
}
