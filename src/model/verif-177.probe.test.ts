/**
 * Verification probes for doc 177 (pass of 2026-10-24). They fed the model the
 * cases the suite never did; the ones marked « fixed » now hold the corrected
 * behaviour (doc 177 §11), the others record a decision (P4, P6, P9).
 */
import { describe, expect, it } from 'vitest';
import { addExpense, correctExpense, markPaid, planExpense, resolveTarget, summary, type Book, type Ctx } from './agent';
import { monthSummary, plannedLines } from './ledger';
import { parseSpokenDay } from './dates';
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
  version: 1, baseCurrency: 'EUR', memory: false, rates: {},
  pockets: [
    { id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }] },
    { id: 'shop', name: 'Magasin', categories: [{ id: 'rentS', name: 'Loyer' }] },
    { id: 'kids', name: 'Enfants', categories: [{ id: 'school', name: 'École', capCents: 50000 }] },
  ],
});
const book = (entries: Entry[] = [], recurring: Recurring[] = [], s = settings()): Book => ({ settings: s, entries, recurring });
const paid = (id: string, amountCents: number, day: string, pocketId: string, categoryId?: string, extra: Partial<Entry> = {}): Entry => ({
  id, status: 'paid', amountCents, currency: 'EUR', day, pocketId, origin: 'typed', createdAt: T, updatedAt: T, ...(categoryId ? { categoryId } : {}), ...extra,
});
const rent: Recurring = { id: 'rent', amountCents: 120000, currency: 'EUR', pocketId: 'shop', categoryId: 'rentS', label: 'loyer', rrule: ruleFor('monthly', '2026-09-05'), start: '2026-09-05', origin: 'agent', review: true, createdAt: '2026-10-24T09:59:00.000Z', updatedAt: '2026-10-24T09:59:00.000Z' };

describe('P1 correctExpense and a recurring line (fixed, doc 177 §11)', () => {
  it('« non, c’était 1300 € » right after « le loyer c’est 1200 € tous les 5 » corrects the RENT, the croquettes stay', () => {
    const croquettes = paid('a', 8000, '2026-10-24', 'home', 'dog', { label: 'croquettes', origin: 'agent', review: true, updatedAt: '2026-10-24T09:00:00.000Z' });
    const c = correctExpense(book([croquettes], [rent]), { amount: 1300 }, ctx);
    expect(c.entry).toBeUndefined();
    expect(c.recurring).toMatchObject({ id: 'rent', amountCents: 130000, review: true });
    expect(nb(c.say)).toBe('Corrigé : 1 300,00 € loyer, Loyer (Magasin).');
  });
  it('named « le loyer »: the recurring line is found', () => {
    expect(correctExpense(book([], [rent]), { what: 'le loyer', amount: 1300 }, ctx).recurring).toMatchObject({ id: 'rent', amountCents: 130000 });
  });
  it('a new day on a recurring line keeps its rhythm from that day', () => {
    const c = correctExpense(book([], [rent]), { what: 'loyer', day: 'le 10' }, ctx);
    expect(c.recurring).toMatchObject({ start: '2026-11-10', rrule: ruleFor('monthly', '2026-11-10') });
  });
});

describe('P2 the ≤ goes on the uncertain figure (fixed, doc 177 §11)', () => {
  it('only a PLAN without a rate: the remaining is exact, the remaining-after-plans is a ceiling', () => {
    const plan: Entry = { ...paid('p', 300000, '2026-10-28', 'kids', 'school', { currency: 'MAD' }), status: 'planned' };
    const s = monthSummary(settings(), [paid('a', 1000, '2026-10-03', 'home', 'dog'), plan], [], '2026-10', '2026-10-24');
    expect(s.remainingCents).toBe(62000 - 1000);
    expect(s.remainingIsCeiling).toBeUndefined();
    expect(s.remainingAfterIsCeiling).toBe(true);
    expect(s.pockets.find((p) => p.pocket.id === 'kids')).toMatchObject({ remainingAfterIsCeiling: true });
    const say = nb(summary(book([paid('a', 1000, '2026-10-03', 'home', 'dog'), plan]), {}, ctx).say);
    expect(say).toContain('Reste 610,00 € sur les budgets');
  });
  it('a SPENT line without a rate in a capped category: the remaining is a ceiling, for the month and its pocket', () => {
    const s = monthSummary(settings(), [paid('a', 1000, '2026-10-03', 'kids', 'school', { currency: 'USD' })], [], '2026-10', '2026-10-24');
    expect(s.remainingIsCeiling).toBe(true);
    expect(s.pockets.find((p) => p.pocket.id === 'kids')).toMatchObject({ remainingIsCeiling: true });
  });
});

describe('P3 markPaid: this month first, and paying ahead is SAID (fixed, doc 177 §11)', () => {
  it('said twice in October, the second « j’ai payé le loyer » pays November’s rent and says the due date', () => {
    const first = markPaid(book([], [rent]), { what: 'loyer' }, ctx);
    expect(first.entry).toMatchObject({ occurrence: '2026-10-05' });
    expect(nb(first.say)).toBe('Payé : 1 200,00 € loyer, Loyer (Magasin), à vérifier.');
    const second = markPaid(book([first.entry!], [rent]), { what: 'loyer' }, ctx);
    expect(second.entry).toMatchObject({ occurrence: '2026-11-05', day: '2026-10-24' });
    expect(nb(second.say)).toBe('Payé d’avance : 1 200,00 € loyer, Loyer (Magasin), échéance 5 novembre, à vérifier.'.replace('’', "'"));
  });
  it('a plan for December paid in October is found, and said as paid ahead', () => {
    const dec: Entry = { ...paid('p', 30000, '2026-12-01', 'kids', 'school', { label: 'vacances' }), status: 'planned', wholeMonth: true };
    const c = markPaid(book([dec]), { what: 'vacances' }, ctx);
    expect(c.entry).toMatchObject({ id: 'p', status: 'paid', day: '2026-10-24' });
    expect(nb(c.say)).toContain('échéance décembre 2026');
  });
  it('a plan of this month is preferred to a later one with the same words', () => {
    const oct: Entry = { ...paid('o', 5000, '2026-10-28', 'home', 'food', { label: 'courses' }), status: 'planned' };
    const nov: Entry = { ...paid('n', 5000, '2026-11-28', 'home', 'food', { label: 'courses' }), status: 'planned' };
    expect(markPaid(book([oct, nov]), { what: 'courses' }, ctx).entry?.id).toBe('o');
  });
  it('a payment day in the future is refused', () => {
    expect(() => markPaid(book([], [rent]), { what: 'loyer', day: 'demain' }, ctx)).toThrow(/^TO_PERSON/);
  });
});

describe('P4 a pocket and a category with the same name (decision, doc 177 §11)', () => {
  it('pocket « Chien » and category « Chien » in Maison: « 80 € pour le chien » goes to the category', () => {
    const s = settings();
    s.pockets.push({ id: 'dogP', name: 'Chien', categories: [] });
    const c = addExpense(book([], [], s), { amount: 80, category: 'chien' }, ctx);
    expect(c.entry).toMatchObject({ pocketId: 'home', categoryId: 'dog' });
  });
  it('the same word as pocket AND category: both resolve to the pocket’s own category when it has one', () => {
    const s = settings();
    s.pockets[2]!.categories.push({ id: 'kidsC', name: 'Enfants' });
    expect(resolveTarget(book([], [], s), 'enfants', 'enfants', ctx, false)).toMatchObject({ pocket: { id: 'kids' }, category: { id: 'kidsC' } });
  });
});

describe('P5 weekdays', () => {
  const monday = '2026-10-26';
  it('« lundi » alone on a Monday is today in both directions (decision, doc 177 §11)', () => {
    expect(parseSpokenDay('lundi', monday, 'future')).toEqual({ day: '2026-10-26' });
    expect(parseSpokenDay('lundi', monday, 'past')).toEqual({ day: '2026-10-26' });
  });
  it('fixed (doc 177 §11): the qualifier wins over the direction', () => {
    expect(parseSpokenDay('lundi dernier', '2026-10-24', 'future')).toEqual({ day: '2026-10-19' });
    expect(parseSpokenDay('lundi prochain', '2026-10-24', 'past')).toEqual({ day: '2026-10-26' });
    expect(parseSpokenDay('lundi dernier', monday, 'past')).toEqual({ day: '2026-10-19' });
    expect(parseSpokenDay('lundi prochain', monday, 'future')).toEqual({ day: '2026-11-02' });
    expect(parseSpokenDay('next monday', monday, 'future')).toEqual({ day: '2026-11-02' });
    expect(parseSpokenDay('el lunes pasado', monday, 'past')).toEqual({ day: '2026-10-19' });
  });
});

describe('P6 a misheard category becomes a durable structure (decision, doc 177 §11)', () => {
  it('« 80 € de croquettes pour Maison, Chine » creates the category « Chine », said aloud, the line to review', () => {
    const c = addExpense(book(), { amount: 80, pocket: 'maison', category: 'chine' }, ctx);
    expect(c.settings!.pockets[0]!.categories.map((x) => x.name)).toContain('Chine');
    expect(nb(c.say)).toContain('nouvelle catégorie');
    expect(c.entry?.review).toBe(true);
  });
});

describe('P7 a pocket or category summary says ITS lines to review (fixed, doc 177 §11)', () => {
  it('two lines to review in Maison, one of them Chien', () => {
    const entries = [
      paid('a', 8000, '2026-10-03', 'home', 'dog', { review: true, origin: 'agent' }),
      paid('b', 1000, '2026-10-07', 'home', 'food', { review: true, origin: 'agent' }),
      paid('c', 1000, '2026-10-07', 'kids', 'school'),
    ];
    expect(nb(summary(book(entries), {}, ctx).say)).toContain('2 lignes à vérifier');
    expect(nb(summary(book(entries), { pocket: 'maison' }, ctx).say)).toContain('2 lignes à vérifier');
    expect(nb(summary(book(entries), { category: 'chien' }, ctx).say)).toContain('1 ligne à vérifier');
    expect(nb(summary(book(entries), { pocket: 'enfants' }, ctx).say)).not.toContain('vérifier');
  });
});

describe('P8 a correction never dates a PAID line in the future (fixed, doc 177 §11)', () => {
  it('« c’était demain » on a paid line is refused, as addExpense refuses it', () => {
    const line = paid('a', 500, '2026-10-02', 'home', 'dog');
    expect(() => correctExpense(book([line]), { day: 'demain' }, ctx)).toThrow(/^TO_PERSON/);
    expect(() => addExpense(book(), { amount: 5, pocket: 'maison', day: 'demain' }, ctx)).toThrow(/TO_PERSON/);
  });
});

describe('P9 planExpense « le 5 » said on the 24th (decision, doc 177 §11)', () => {
  it('a monthly rent planned « le 5 » starts next month, and its occurrences include November', () => {
    const c = planExpense(book(), { amount: 1200, pocket: 'magasin', category: 'loyer', when: 'le 5', repeat: 'monthly' }, ctx);
    expect(c.recurring?.start).toBe('2026-11-05');
    expect(plannedLines([], [c.recurring!], '2026-11', '2026-10-24').map((l) => l.day)).toEqual(['2026-11-05']);
    expect(plannedLines([], [c.recurring!], '2026-10', '2026-10-24')).toEqual([]);
  });
});
