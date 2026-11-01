/**
 * The orb's actions on the budget (doc 177 §3, §5): every figure said comes
 * from the sums, a line written by an agent waits for review, nothing is
 * guessed, nothing is deleted.
 */
import { describe, expect, it } from 'vitest';
import { addExpense, correctExpense, markPaid, planExpense, resolveTarget, setBudget, summary, type Book, type Ctx } from './agent';
import { ruleFor } from './recurrence';
import fr from '../locales/fr.json';
import type { BudgetSettings, Entry, Recurring } from './types';

const dict = fr as Record<string, string>;
const t = (key: string, vars?: Record<string, string | number>) => {
  let text = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) text = text.split(`{{${k}}}`).join(String(v));
  return text;
};
const ctx: Ctx = { today: '2026-10-24', now: '2026-10-24T10:00:00.000Z', lang: 'fr', t };
const nb = (s: string) => s.replace(/[  ]/g, ' ');

const T = '2026-10-01T10:00:00.000Z';
const settings = (): BudgetSettings => ({
  version: 1, baseCurrency: 'EUR', memory: false, rates: { MAD: { value: 0.1, day: '2026-10-20' } },
  pockets: [
    { id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }, { id: 'rentH', name: 'Loyer' }] },
    { id: 'shop', name: 'Magasin de pyjamas', categories: [{ id: 'rentS', name: 'Loyer' }, { id: 'stock', name: 'Stock' }] },
    { id: 'kids', name: 'Enfants', categories: [{ id: 'school', name: 'École' }] },
  ],
});
const book = (entries: Entry[] = [], recurring: Recurring[] = []): Book => ({ settings: settings(), entries, recurring });
const paid = (id: string, amountCents: number, day: string, pocketId: string, categoryId?: string, extra: Partial<Entry> = {}): Entry => ({
  id, status: 'paid', amountCents, currency: 'EUR', day, pocketId, origin: 'typed', createdAt: T, updatedAt: T, ...(categoryId ? { categoryId } : {}), ...extra,
});

describe('addExpense', () => {
  it('« 80 € de croquettes pour le chien »: the pocket is the one that holds Chien, the line waits for review, the cap left is a sum', () => {
    const c = addExpense(book([paid('a', 2000, '2026-10-02', 'home', 'dog')]), { amount: 80, category: 'le chien', label: 'croquettes' }, ctx);
    expect(c.entry).toMatchObject({ status: 'paid', amountCents: 8000, currency: 'EUR', day: '2026-10-24', pocketId: 'home', categoryId: 'dog', label: 'croquettes', origin: 'agent', review: true });
    expect(nb(c.say)).toBe('Noté : 80,00 € croquettes, Chien (Maison), à vérifier. Reste 20,00 € sur Chien ce mois-ci.');
  });

  it('a day is read from the person\'s words, at each call', () => {
    expect(addExpense(book(), { amount: 45, pocket: 'maison', category: 'courses', day: 'hier' }, ctx).entry?.day).toBe('2026-10-23');
  });

  it('🚨 no pocket and no category that names one: the person is ASKED, never the first pocket', () => {
    expect(() => addExpense(book(), { amount: 30 }, ctx)).toThrow(/^TO_PERSON: Maison, Magasin de pyjamas, Enfants : dans quelle poche \?$/);
    expect(() => addExpense(book(), { amount: 30, category: 'vacances' }, ctx)).toThrow(/^TO_PERSON: .* : dans quelle poche \?$/);
  });

  it('« loyer » is in two pockets: refused AMBIGUOUS with both, never the first', () => {
    expect(() => addExpense(book(), { amount: 1200, category: 'loyer' }, ctx)).toThrow(/^AMBIGUOUS: .*Loyer \(Maison\).*Loyer \(Magasin de pyjamas\)/);
  });

  it('a category the pocket lacks is created and said', () => {
    const c = addExpense(book(), { amount: 95, pocket: 'maison', category: 'vétérinaire' }, ctx);
    const created = c.settings!.pockets.find((p) => p.id === 'home')!.categories.find((x) => x.name === 'Vétérinaire');
    expect(created).toBeDefined();
    expect(c.entry?.categoryId).toBe(created!.id);
    expect(c.say).toContain('nouvelle catégorie');
  });

  it('a pocket said as a category still finds the pocket', () => {
    expect(addExpense(book(), { amount: 12, category: 'enfants' }, ctx).entry).toMatchObject({ pocketId: 'kids' });
  });

  it('the currency word said, and an unknown one is asked about, never assumed', () => {
    expect(addExpense(book(), { amount: 2000, currency: 'dirhams', pocket: 'enfants' }, ctx).entry?.currency).toBe('MAD');
    expect(() => addExpense(book(), { amount: 20, currency: 'cailloux', pocket: 'enfants' }, ctx)).toThrow(/^TO_PERSON: .*cailloux/);
  });

  it('a payment in the future is refused toward a plan', () => {
    expect(() => addExpense(book(), { amount: 20, pocket: 'enfants', day: 'demain' }, ctx)).toThrow(/^TO_PERSON: .*je prévois/);
  });

  it('a bad amount is refused', () => {
    expect(() => addExpense(book(), { amount: 0, pocket: 'enfants' }, ctx)).toThrow(/^BAD_ARG/);
    expect(() => addExpense(book(), { amount: '80', pocket: 'enfants' }, ctx)).toThrow(/^BAD_ARG/);
  });
});

describe('planExpense', () => {
  it('« 300 € pour les enfants en décembre » is a plan for the month, never spent', () => {
    const c = planExpense(book(), { amount: 300, category: 'enfants', when: 'en décembre' }, ctx);
    expect(c.entry).toMatchObject({ status: 'planned', day: '2026-12-01', wholeMonth: true, pocketId: 'kids', review: true });
    expect(nb(c.say)).toBe('Prévu : 300,00 €, Enfants, décembre 2026.');
  });

  it('« le loyer du magasin, 1200 € tous les 5 » is a recurring line on the Agenda\'s rule', () => {
    const c = planExpense(book(), { amount: 1200, pocket: 'magasin', category: 'loyer', when: 'le 5', repeat: 'monthly' }, ctx);
    expect(c.recurring).toMatchObject({ amountCents: 120000, pocketId: 'shop', categoryId: 'rentS', start: '2026-11-05', rrule: ruleFor('monthly', '2026-11-05'), review: true });
    expect(c.entry).toBeUndefined();
    expect(nb(c.say)).toBe('Prévu : 1 200,00 €, Loyer (Magasin de pyjamas), chaque mois le 5.');
  });

  it('when is needed', () => {
    expect(() => planExpense(book(), { amount: 10, pocket: 'enfants' }, ctx)).toThrow(/^TO_PERSON: Pour quand/);
  });
});

describe('markPaid', () => {
  const rent: Recurring = { id: 'rent', amountCents: 120000, currency: 'EUR', pocketId: 'shop', categoryId: 'rentS', rrule: ruleFor('monthly', '2026-09-05'), start: '2026-09-05', origin: 'typed', createdAt: T, updatedAt: T };

  it('« j\'ai payé le loyer du magasin »: a paid line answers this month\'s occurrence', () => {
    const c = markPaid(book([], [rent]), { what: 'loyer magasin' }, ctx);
    expect(c.entry).toMatchObject({ status: 'paid', amountCents: 120000, pocketId: 'shop', recurringId: 'rent', occurrence: '2026-10-05', day: '2026-10-24', review: true });
  });

  it('a planned line becomes paid, its month-only flag gone, with the amount actually paid', () => {
    const plan: Entry = { ...paid('p1', 30000, '2026-10-01', 'kids', 'school', { label: 'cantine' }), status: 'planned', wholeMonth: true };
    const c = markPaid(book([plan]), { what: 'cantine', amount: 280 }, ctx);
    expect(c.entry).toMatchObject({ id: 'p1', status: 'paid', amountCents: 28000, day: '2026-10-24' });
    expect(c.entry?.wholeMonth).toBeUndefined();
  });

  it('two plans with the same words are refused AMBIGUOUS', () => {
    const a: Entry = { ...paid('p1', 100, '2026-10-28', 'home', 'rentH'), status: 'planned' };
    expect(() => markPaid(book([a], [rent]), { what: 'loyer' }, ctx)).toThrow(/^AMBIGUOUS/);
  });

  it('nothing planned is said', () => {
    expect(() => markPaid(book(), { what: 'loyer' }, ctx)).toThrow(/^TO_PERSON: Rien de prévu/);
  });
});

describe('correctExpense', () => {
  it('« non, c\'était 18 € » corrects the last line written, back to review', () => {
    const older = paid('a', 500, '2026-10-02', 'home', 'food');
    const last = paid('b', 8000, '2026-10-24', 'home', 'dog', { updatedAt: '2026-10-24T09:00:00.000Z', origin: 'agent', review: true });
    const c = correctExpense(book([older, last]), { amount: 18 }, ctx);
    expect(c.entry).toMatchObject({ id: 'b', amountCents: 1800, review: true });
  });

  it('moving a line to another pocket drops a category that pocket does not have', () => {
    const line = paid('a', 500, '2026-10-02', 'home', 'dog');
    const c = correctExpense(book([line]), { what: 'chien', pocket: 'enfants' }, ctx);
    expect(c.entry?.pocketId).toBe('kids');
    expect(c.entry?.categoryId).toBeUndefined();
  });

  it('a category said alone is looked for in the line\'s own pocket first', () => {
    const line = paid('a', 500, '2026-10-02', 'shop', 'stock');
    expect(correctExpense(book([line]), { category: 'loyer' }, ctx).entry).toMatchObject({ pocketId: 'shop', categoryId: 'rentS' });
  });

  it('nothing to correct is said', () => {
    expect(() => correctExpense(book(), { amount: 3 }, ctx)).toThrow(/^TO_PERSON/);
  });
});

describe('setBudget', () => {
  it('sets the cap and says what is left from the sums', () => {
    const c = setBudget(book([paid('a', 3000, '2026-10-03', 'home', 'food')]), { category: 'courses', amount: 400 }, ctx);
    expect(c.settings!.pockets[0]!.categories.find((x) => x.id === 'food')!.capCents).toBe(40000);
    expect(nb(c.say)).toBe('Budget de Courses : 400,00 € par mois. Reste 370,00 € sur Courses ce mois-ci.');
  });
});

describe('summary — the app\'s own sums, said', () => {
  const entries = [
    paid('a', 8000, '2026-10-03', 'home', 'dog'),
    paid('b', 300000, '2026-10-05', 'kids', 'school', { currency: 'MAD' }),
    paid('c', 5000, '2026-10-06', 'kids', 'school', { currency: 'USD' }),
    paid('d', 1000, '2026-10-07', 'home', 'food', { review: true, origin: 'agent' }),
  ];

  it('the month: a floor when a currency has no rate, and the lines left to review', () => {
    const s = summary(book(entries), {}, ctx);
    expect(nb(s.say)).toBe('octobre 2026 : ≥ 390,00 € dépensés, 0,00 € prévus. Reste 40,00 € sur les budgets. Plus 1 ligne en USD sans taux. 1 ligne à vérifier.');
    expect(s.figures).toMatchObject({ spentCents: 39000, toReview: 1 });
  });

  it('a category, with its cap', () => {
    expect(nb(summary(book(entries), { category: 'chien' }, ctx).say)).toBe('Chien (Maison), octobre 2026 : 80,00 € dépensés, 0,00 € prévus. Reste 40,00 € sur Chien ce mois-ci.');
  });

  it('a past month by its name', () => {
    expect(summary(book(entries), { month: 'le mois dernier' }, ctx).show.month).toBe('2026-09');
  });

  it('an unknown month is said', () => {
    expect(() => summary(book(), { month: 'bientôt' }, ctx)).toThrow(/^TO_PERSON/);
  });
});

describe('resolveTarget', () => {
  it('one pocket and nothing said: that pocket', () => {
    const one: Book = { settings: { ...settings(), pockets: [settings().pockets[2]!] }, entries: [], recurring: [] };
    expect(resolveTarget(one, '', '', ctx, false).pocket.id).toBe('kids');
  });
});
