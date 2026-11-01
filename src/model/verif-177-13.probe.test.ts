/**
 * Verification probes for doc 177 §13.2 / §13.3 (pure model), logic verifier
 * 2026-10-26 (session 1f38ac08): the real settings.json put through a change
 * of main currency, a round trip, the smallest cap, a comparison asked for a
 * month that has not happened, a category whose only spending has no rate.
 */
import { describe, expect, it } from 'vitest';
import { linkToBase, rebaseSettings } from './currencies';
import { compareWithPreviousMonth, rankCategories, spentUntil } from './insights';
import { monthSummary } from './ledger';
import { convert } from './money';
import type { BudgetSettings, Entry } from './types';

/** Tony's settings.json, verbatim (2026-10-26). */
const REAL: BudgetSettings = {
  version: 1,
  baseCurrency: 'EUR',
  pockets: [
    { id: 'p_mvmpikbcb317cf653346', name: 'Maison', icon: '🏠', categories: [
      { id: 'c_mvmpikbc9b119522ea6b', name: 'Loyer' }, { id: 'c_mvmpikbc806f43ab117a', name: 'Courses' },
      { id: 'c_mvmpikbc01c456208512', name: 'Chien', capCents: 12000 }, { id: 'c_mvmpikbcca12480be1df', name: 'Ménage' } ] },
    { id: 'p_mvmpikbc7aae97e517c5', name: 'Famille', icon: '👨‍👧', categories: [
      { id: 'c_mvmpikbc04324545ffec', name: 'Enfants' }, { id: 'c_mvmpikbcf26b256994ac', name: 'École' }, { id: 'c_mvmpikbc2537d9fbefa4', name: 'Santé' } ] },
    { id: 'p_mvmpikbc9937537b013a', name: 'Pro', icon: '💼', categories: [
      { id: 'c_mvmpikbc93beac12224e', name: 'Loyer du local' }, { id: 'c_mvmpikbc93c1b58053a2', name: 'Fournisseurs' }, { id: 'c_mvmpikbce4245683ef91', name: 'Salaires' } ] },
  ],
  rates: {},
  memory: true,
};
const T = '2026-10-24T18:57:00.000Z';
const paid = (id: string, amountCents: number, day: string, categoryId: string, extra: Partial<Entry> = {}): Entry =>
  ({ id, status: 'paid', amountCents, currency: 'EUR', day, pocketId: 'p_mvmpikbcb317cf653346', categoryId, origin: 'typed', createdAt: T, updatedAt: T, ...extra });

describe('the real settings through a change of main currency (§13.2)', () => {
  it('EUR → MAD at « 1 EUR = 10,87 MAD », no rate held: the link is asked, Chien becomes 1 304,40 MAD, the nine other categories stay uncapped, EUR joins the used currencies', () => {
    expect(linkToBase(REAL, 'MAD')).toBeNull();
    const next = rebaseSettings(REAL, 'MAD', { value: 10.87, day: '2026-10-26' });
    expect(next.baseCurrency).toBe('MAD');
    expect(next.rates).toEqual({ EUR: { value: 10.87, day: '2026-10-26' } });
    const caps = next.pockets.flatMap((p) => p.categories.map((c) => [c.name, c.capCents] as const));
    expect(caps.filter(([, cap]) => cap !== undefined)).toEqual([['Chien', 130440]]);
    expect(next.currencies).toEqual(['EUR']);
    // Memory and pockets untouched.
    expect(next.memory).toBe(true);
    expect(next.pockets.map((p) => p.name)).toEqual(['Maison', 'Famille', 'Pro']);
  });

  it('a round trip EUR → MAD → EUR gives the cap back to the cent and leaves one rate, the MAD one', () => {
    const mad = rebaseSettings(REAL, 'MAD', { value: 10, day: '2026-10-26' });
    const back = rebaseSettings(mad, 'EUR', linkToBase(mad, 'EUR')!);
    expect(back.baseCurrency).toBe('EUR');
    expect(back.pockets[0]!.categories[2]!.capCents).toBe(12000);
    expect(back.rates).toEqual({ MAD: { value: 0.1, day: '2026-10-26' } });
    expect(back.currencies).toEqual(['MAD']);
  });

  it('🎭 the smallest cap: 1 cent of EUR rebased at 0.3 rounds to 0 and is DROPPED, never written as a cent nobody chose (fixed after the pass)', () => {
    const tiny: BudgetSettings = { ...REAL, pockets: [{ id: 'p', name: 'P', categories: [{ id: 'c', name: 'C', capCents: 1 }] }] };
    const next = rebaseSettings(tiny, 'XXX', { value: 0.3, day: '2026-10-26' });
    // Found as `Math.max(1, converted)` by the pass: a cap under a cent is now unset.
    expect(next.pockets[0]!.categories[0]!.capCents).toBeUndefined();
    expect(convert(1, 'EUR', 'XXX', next.rates)).toBe(0);
  });
});

describe('the same point of last month, asked for a month that has not happened (§13.3)', () => {
  it('🎭 November asked on October 24: the November side is empty by construction, and no percentage is given (found as « −100 % » by the pass, fixed)', () => {
    const c = compareWithPreviousMonth(REAL, [paid('a', 4500, '2026-10-24', 'c_mvmpikbc806f43ab117a')], '2026-11', '2026-10-24');
    expect(c.previousMonth).toBe('2026-10');
    expect(c.current.cents).toBe(0);
    expect(c.previous.cents).toBe(4500);
    expect(c.sameDay).toBeUndefined();
    // A month that has not begun compares to nothing.
    expect(c.percent).toBeUndefined();
  });

  it('on the 1st of the month both sides are one day long', () => {
    const entries = [paid('a', 1000, '2026-11-01', 'c_mvmpikbc806f43ab117a'), paid('b', 2000, '2026-10-01', 'c_mvmpikbc806f43ab117a'), paid('c', 9000, '2026-10-15', 'c_mvmpikbc806f43ab117a')];
    const c = compareWithPreviousMonth(REAL, entries, '2026-11', '2026-11-01');
    expect(c.sameDay).toBe(1);
    expect(c.current.cents).toBe(1000);
    expect(c.previous.cents).toBe(2000);
    expect(c.percent).toBe(-50);
    expect(spentUntil(REAL, entries, '2026-10', 1).cents).toBe(2000);
  });
});

describe('where the money goes, with a category whose only spending has no rate (§13.3, rule 5)', () => {
  it('🎭 the category is ranked with 0 converted cents and NO share (found as « 0 % » beside « ≥ 0,00 € » by the pass, fixed)', () => {
    const entries = [paid('a', 4500, '2026-10-24', 'c_mvmpikbc806f43ab117a'), paid('u', 5000, '2026-10-20', 'c_mvmpikbc01c456208512', { currency: 'USD' })];
    const s = monthSummary(REAL, entries, [], '2026-10', '2026-10-24');
    const ranks = rankCategories(s, 5);
    const chien = ranks.find((r) => r.category?.name === 'Chien')!;
    expect(chien).toBeDefined();
    expect(chien.spent.cents).toBe(0);
    expect(chien.spent.unconverted).toEqual({ USD: { cents: 5000, count: 1 } });
    // Found as Math.round(0 * 100) % = « 0 % » by the pass: no share when the converted sum is 0.
    expect(chien.share).toBeUndefined();
  });
});
