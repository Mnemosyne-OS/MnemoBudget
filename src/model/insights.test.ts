import { describe, expect, it } from 'vitest';
import { byCurrency, compareWithPreviousMonth, rankCategories, searchLines, spentUntil, sumAmounts, trend } from './insights';
import { monthSummary } from './ledger';
import { ruleFor } from './recurrence';
import type { BudgetSettings, Entry, Recurring } from './types';

const T = '2026-10-01T10:00:00.000Z';
const settings: BudgetSettings = {
  version: 1,
  baseCurrency: 'EUR',
  memory: false,
  rates: { MAD: { value: 0.1, day: '2026-10-20' } },
  pockets: [
    { id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }] },
    { id: 'kids', name: 'Enfants', categories: [{ id: 'school', name: 'École' }] },
  ],
};
let n = 0;
const paid = (amountCents: number, day: string, pocketId: string, categoryId?: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`, status: 'paid', amountCents, currency: 'EUR', day, pocketId, origin: 'typed', createdAt: T, updatedAt: T,
  ...(categoryId ? { categoryId } : {}), ...extra,
});
const rent: Recurring = {
  id: 'rent', amountCents: 50000, currency: 'EUR', pocketId: 'home', categoryId: 'food', rrule: ruleFor('monthly', '2026-08-05'), start: '2026-08-05',
  origin: 'typed', createdAt: T, updatedAt: T,
};
const entries = [
  paid(8000, '2026-10-03', 'home', 'dog'),
  paid(1050, '2026-10-10', 'home', 'food'),
  paid(4000, '2026-10-30', 'home', 'food'),
  paid(2000, '2026-09-02', 'home', 'dog'),
  paid(3000, '2026-09-20', 'home', 'dog'),
  paid(100000, '2026-10-12', 'kids', 'school', { currency: 'MAD' }),
  paid(7000, '2026-08-15', 'kids'),
];

describe('trend — the months before, oldest first', () => {
  it('six months up to the one shown, each a sum over its own lines', () => {
    const t = trend(settings, entries, [rent], '2026-10', '2026-10-24');
    expect(t.map((p) => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(t[5]!.spent.cents).toBe(8000 + 1050 + 4000 + 10000);
    expect(t[4]!.spent.cents).toBe(5000);
    expect(t[3]!.spent.cents).toBe(7000);
    expect(t[0]!.spent.cents).toBe(0);
    // The rent is planned in August, September and October (unpaid), never counted as spent.
    expect(t[3]!.planned.cents).toBe(50000);
    expect(t[5]!.planned.cents).toBe(50000);
  });
});

describe('the same point of last month', () => {
  it('both sides stop at today\'s day of the month, and the change is a percentage', () => {
    const c = compareWithPreviousMonth(settings, entries, '2026-10', '2026-10-24');
    // Up to the 24th: October 8000 + 1050 + 10000 (MAD converted); September 2000 + 3000.
    expect(c.current.cents).toBe(19050);
    expect(c.previous.cents).toBe(5000);
    expect(c.sameDay).toBe(24);
    expect(c.previousMonth).toBe('2026-09');
    expect(c.percent).toBe(281);
  });

  it('a past month compares whole against whole', () => {
    const c = compareWithPreviousMonth(settings, entries, '2026-09', '2026-10-24');
    expect(c.current.cents).toBe(5000);
    expect(c.previous.cents).toBe(7000);
    expect(c.sameDay).toBeUndefined();
    expect(c.percent).toBe(-29);
  });

  it('🎭 no percentage against a month of zero, nor when a line without a rate is on either side', () => {
    expect(compareWithPreviousMonth(settings, entries, '2026-08', '2026-10-24').percent).toBeUndefined();
    const withUsd = [...entries, paid(5000, '2026-10-05', 'kids', 'school', { currency: 'USD' })];
    const c = compareWithPreviousMonth(settings, withUsd, '2026-10', '2026-10-24');
    expect(c.percent).toBeUndefined();
    expect(c.current.unconverted).toEqual({ USD: { cents: 5000, count: 1 } });
  });

  it('🎭 a month that has not begun compares to nothing: no « −100 % » against the month before (verifier, 2026-10-26)', () => {
    const c = compareWithPreviousMonth(settings, entries, '2026-11', '2026-10-24');
    expect(c.current.cents).toBe(0);
    expect(c.previous.cents).toBeGreaterThan(0);
    expect(c.percent).toBeUndefined();
  });

  it('sumAmounts: the lines shown add up in the base, a line without a rate counted apart (the history header)', () => {
    const a = sumAmounts(settings, [{ amountCents: 4500, currency: 'EUR' }, { amountCents: 100000, currency: 'MAD' }, { amountCents: 700, currency: 'USD' }]);
    expect(a.cents).toBe(14500);
    expect(a.converted).toEqual(['MAD']);
    expect(a.unconverted).toEqual({ USD: { cents: 700, count: 1 } });
  });

  it('spentUntil: a 31st asked of September keeps the whole month, the 10th stops there', () => {
    expect(spentUntil(settings, entries, '2026-09', 31).cents).toBe(5000);
    expect(spentUntil(settings, entries, '2026-10', 10).cents).toBe(9050);
  });
});

describe('the categories that weigh most', () => {
  it('heaviest first, with their share of the month, at most the limit; nothing spent is not ranked', () => {
    const s = monthSummary(settings, entries, [rent], '2026-10', '2026-10-24');
    const ranks = rankCategories(s, 2);
    expect(ranks.map((r) => r.category?.name)).toEqual(['École', 'Chien']);
    // A category whose only money has no rate is ranked (it is money) but carries no share.
    const onlyUsd = monthSummary(settings, [paid(5000, '2026-10-05', 'kids', 'school', { currency: 'USD' })], [], '2026-10', '2026-10-24');
    expect(rankCategories(onlyUsd)[0]!.share).toBeUndefined();
    expect(ranks[0]!.spent.cents).toBe(10000);
    expect(ranks[0]!.share).toBeCloseTo(10000 / 23050, 5);
    expect(rankCategories(s).map((r) => r.category?.name)).toEqual(['École', 'Chien', 'Courses']);
  });
});

describe('the month, currency by currency', () => {
  it('raw totals per currency, the base first, converted when a rate exists and null otherwise', () => {
    const withUsd = [...entries, paid(5000, '2026-10-05', 'kids', 'school', { currency: 'USD' })];
    const s = monthSummary(settings, withUsd, [], '2026-10', '2026-10-24');
    const totals = byCurrency(settings, s.paid);
    expect(totals).toEqual([
      { currency: 'EUR', cents: 13050, count: 3, baseCents: 13050 },
      { currency: 'MAD', cents: 100000, count: 1, baseCents: 10000 },
      { currency: 'USD', cents: 5000, count: 1, baseCents: null },
    ]);
  });
});

describe('searching the lines', () => {
  it('finds by label, pocket or category, accents and case folded; an empty query keeps all', () => {
    const lines = [paid(100, '2026-10-01', 'home', 'dog', { label: 'Croquettes' }), paid(200, '2026-10-02', 'kids', 'school')];
    expect(searchLines(lines, settings, 'ecole').map((l) => l.amountCents)).toEqual([200]);
    expect(searchLines(lines, settings, 'CROQ').map((l) => l.amountCents)).toEqual([100]);
    expect(searchLines(lines, settings, 'maison').map((l) => l.amountCents)).toEqual([100]);
    expect(searchLines(lines, settings, '  ')).toHaveLength(2);
  });
});
