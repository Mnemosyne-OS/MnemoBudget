/**
 * Was RED ON PURPOSE during the doc 177 §13 verification pass (2026-10-26,
 * session 1f38ac08): two findings, each written as the rule the doc states.
 * GREEN since the fixes that followed the pass (LinesView sums every line
 * shown through the rates; a month that has not begun carries no percentage):
 * it is the regression test of both. Kept apart from
 * App.verif-177-13.probe.test.tsx, as the mutation file names it.
 *
 *   C. 🎭 « le mois dernier au même point » asked for a month that has not
 *      happened prints « −100 % » (insights.compareWithPreviousMonth takes a
 *      future month as a whole, empty, month).
 *   D. one month, two doors: a MAD line WITH a rate is in the dashboard's
 *      « Dépensé » (converted), but the history's total of the same lines
 *      leaves it out, says « d'autres devises à part » and never carries « ≥ »
 *      (LinesView hardcodes `unconverted: {}`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { memoryIO } from './test/memoryIO';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
const h = vi.hoisted(() => ({
  io: null as unknown as ReturnType<typeof import('./test/memoryIO').memoryIO>,
  folder: '/home/a/Budget' as string | null,
  handlers: {} as Handlers,
}));

vi.mock('./data/host', () => ({
  PLUGIN_ID: '@mnemosyne-plugins/mnemo-budget',
  BUDGET_SPINE: 'BUDGET_LINE',
  hostIO: {
    mkdir: (p: string) => h.io.mkdir(p),
    readDir: (p: string) => h.io.readDir(p),
    readFile: (p: string) => h.io.readFile(p),
    writeFile: (p: string, c: string) => h.io.writeFile(p, c),
  },
  sdk: { onAgentActions: (handlers: Handlers) => { h.handlers = handlers; return { ready: Promise.resolve(), off: () => {} }; } },
  deleteFile: vi.fn(async (p: string) => { h.io.files.delete(p); }),
  pickFolder: vi.fn(async () => h.folder),
  appFolder: vi.fn(async () => { throw new Error('UNKNOWN_ACTION'); }),
  openFolderInOS: vi.fn(async () => ({ success: true })),
  readRememberedFolder: () => null,
  readMirroredFolder: vi.fn(async () => null),
  rememberFolder: vi.fn(async () => {}),
  ensureSandbox: vi.fn(async () => ({ vault: 'APP-mnemo-budget', unlocked: false })),
  rememberLine: vi.fn(async () => {}),
}));

import App from './App';
import { setLangMode } from './i18n';

const nb = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const T0 = '2026-10-24T18:57:00.000Z';
const MAISON = 'p_mvmpikbcb317cf653346';
const COURSES = 'c_mvmpikbc806f43ab117a';
const CHIEN = 'c_mvmpikbc01c456208512';
/** Tony's settings.json (2026-10-26), with what each case adds. */
const realSettings = (extra: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, baseCurrency: 'EUR', memory: true, rates: {},
  pockets: [
    { id: MAISON, name: 'Maison', icon: '🏠', categories: [
      { id: 'c_mvmpikbc9b119522ea6b', name: 'Loyer' }, { id: COURSES, name: 'Courses' }, { id: CHIEN, name: 'Chien', capCents: 12000 }, { id: 'c_mvmpikbcca12480be1df', name: 'Ménage' } ] },
    { id: 'p_mvmpikbc7aae97e517c5', name: 'Famille', icon: '👨‍👧', categories: [
      { id: 'c_mvmpikbc04324545ffec', name: 'Enfants' }, { id: 'c_mvmpikbcf26b256994ac', name: 'École' }, { id: 'c_mvmpikbc2537d9fbefa4', name: 'Santé' } ] },
    { id: 'p_mvmpikbc9937537b013a', name: 'Pro', icon: '💼', categories: [
      { id: 'c_mvmpikbc93beac12224e', name: 'Loyer du local' }, { id: 'c_mvmpikbc93c1b58053a2', name: 'Fournisseurs' }, { id: 'c_mvmpikbce4245683ef91', name: 'Salaires' } ] },
  ],
  ...extra,
});
const line136 = JSON.stringify({ id: 'e_orb45', status: 'paid', amountCents: 4500, currency: 'EUR', day: '2026-10-24', pocketId: MAISON, categoryId: COURSES, label: 'courses', origin: 'agent', review: true, createdAt: T0, updatedAt: T0 });
const paid = (id: string, amountCents: number, day: string, categoryId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, status: 'paid', amountCents, currency: 'EUR', day, pocketId: MAISON, categoryId, origin: 'typed', createdAt: T0, updatedAt: T0, ...extra });

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.folder = '/home/a/Budget';
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

async function openBudget() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
  await screen.findByTestId('figure-spent');
}

describe('C. a month that has not happened yet (RED: finding)', () => {
  it('🎭 « le mois dernier au même point » for November, on October 24: no percentage can be honest, so none should be shown', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
    expect(screen.getByRole('button', { name: /novembre 2026/ })).toBeInTheDocument();
    expect(screen.getByText('octobre 2026')).toBeInTheDocument();
    const delta = document.querySelector('.b-delta');
    expect(delta ? nb(delta.textContent) : null).toBeNull();
  });
});

describe('D. one month, two doors (RED: finding)', () => {
  it('rule 4/5: a MAD line WITH a rate is in the dashboard\'s « Dépensé »; the history\'s total of the same lines should say the same money, or carry « ≥ »', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings({ rates: { MAD: { value: 0.1, day: '2026-10-20' } }, currencies: ['MAD'] }));
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    h.io.files.set('/home/a/Budget/entries/dogmad.json', paid('dogmad', 100000, '2026-10-12', CHIEN, { currency: 'MAD' }));
    await openBudget();
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('145,00 €');
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    const head = screen.getByRole('heading', { name: /2 lignes/ }).closest('.b-card-head')!;
    expect(nb(head.textContent)).toMatch(/145,00 €|≥/);
  });
});
