import { describe, expect, it } from 'vitest';
import { monthSummary, plannedLines } from './ledger';
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
    { id: 'kids', name: 'Enfants', categories: [{ id: 'school', name: 'École', capCents: 50000 }] },
  ],
};
let n = 0;
const paid = (amountCents: number, day: string, pocketId: string, categoryId?: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`, status: 'paid', amountCents, currency: 'EUR', day, pocketId, origin: 'typed', createdAt: T, updatedAt: T,
  ...(categoryId ? { categoryId } : {}), ...extra,
});
const rent: Recurring = {
  id: 'rent', amountCents: 120000, currency: 'EUR', pocketId: 'home', rrule: ruleFor('monthly', '2026-09-05'), start: '2026-09-05',
  origin: 'typed', createdAt: T, updatedAt: T,
};

describe('monthSummary — the figures are sums over the lines', () => {
  const entries = [
    paid(8000, '2026-10-03', 'home', 'dog'),
    paid(1050, '2026-10-10', 'home', 'food'),
    paid(2000, '2026-09-28', 'home', 'dog'), // last month
    paid(300000, '2026-10-12', 'kids', 'school', { currency: 'MAD' }),
    paid(5000, '2026-10-15', 'kids', 'school', { currency: 'USD' }), // no rate
  ];
  const s = monthSummary(settings, entries, [rent], '2026-10', '2026-10-24');

  it('spent this month, in the base currency', () => {
    expect(s.spent.cents).toBe(8000 + 1050 + 30000);
  });

  it('🚨 a currency without a rate stays apart, never converted at parity', () => {
    expect(s.spent.unconverted).toEqual({ USD: { cents: 5000, count: 1 } });
  });

  it('per pocket and per category', () => {
    const home = s.pockets.find((p) => p.pocket.id === 'home')!;
    expect(home.spent.cents).toBe(9050);
    expect(home.categories.find((c) => c.category?.id === 'dog')!.spent.cents).toBe(8000);
  });

  it('the rent due on the 5th is planned until it is marked paid', () => {
    expect(s.planned.cents).toBe(120000);
    expect(s.plannedLines[0]).toMatchObject({ day: '2026-10-05', overdue: true, recurring: rent });
  });

  it('a cap compares only with its own categories, and a capped category without a rate makes it a ceiling', () => {
    expect(s.capCents).toBe(12000 + 50000);
    expect(s.remainingCents).toBe(62000 - 8000 - 30000);
    expect(s.remainingIsCeiling).toBe(true);
  });

  it('paid lines are the month\'s, newest first', () => {
    expect(s.paid.map((e) => e.day)).toEqual(['2026-10-15', '2026-10-12', '2026-10-10', '2026-10-03']);
  });
});

describe('caps', () => {
  it('🎭 no cap set = no remaining at all, never « 0 left »', () => {
    const none: BudgetSettings = { ...settings, pockets: [{ id: 'home', name: 'Maison', categories: [{ id: 'food', name: 'Courses' }] }] };
    const s = monthSummary(none, [paid(1000, '2026-10-03', 'home', 'food')], [], '2026-10', '2026-10-24');
    expect(s.capCents).toBeUndefined();
    expect(s.remainingCents).toBeUndefined();
  });
  it('no unconverted line in a capped category = an exact remaining', () => {
    const s = monthSummary(settings, [paid(1000, '2026-10-03', 'home', 'dog')], [], '2026-10', '2026-10-24');
    expect(s.remainingIsCeiling).toBeUndefined();
    expect(s.remainingAfterPlannedCents).toBe(62000 - 1000);
  });
});

describe('plannedLines', () => {
  it('a paid occurrence no longer shows as planned', () => {
    const answered = paid(120000, '2026-10-06', 'home', undefined, { recurringId: 'rent', occurrence: '2026-10-05' });
    expect(plannedLines([answered], [rent], '2026-10', '2026-10-24')).toEqual([]);
  });

  it('a plan left unpaid last month shows in the current month as overdue, not in a past month view', () => {
    const late: Entry = { ...paid(4000, '2026-09-20', 'home'), status: 'planned' };
    expect(plannedLines([late], [], '2026-10', '2026-10-24')).toMatchObject([{ key: late.id, overdue: true }]);
    expect(plannedLines([late], [], '2026-11', '2026-10-24')).toEqual([]);
  });

  it('a plan for « December » is not overdue in October', () => {
    const later: Entry = { ...paid(30000, '2026-12-01', 'kids'), status: 'planned', wholeMonth: true };
    expect(plannedLines([later], [], '2026-12', '2026-10-24')).toMatchObject([{ overdue: false, wholeMonth: true }]);
  });

  it('lines of a removed pocket still count, under a missing pocket', () => {
    const s = monthSummary(settings, [paid(700, '2026-10-02', 'gone')], [], '2026-10', '2026-10-24');
    expect(s.pockets.find((p) => p.pocket.id === 'gone')).toMatchObject({ missing: true, spent: { cents: 700 } });
    expect(s.spent.cents).toBe(700);
  });
});
