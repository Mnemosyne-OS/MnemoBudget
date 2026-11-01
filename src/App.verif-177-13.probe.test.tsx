/**
 * Verification probes for doc 177 §13 (the redesigned screen), written by the
 * logic verifier on 2026-10-26 (session 1f38ac08). They mount the real App on
 * an in-memory folder and feed it what the suite never gives it:
 *
 *   - Tony's REAL settings.json (copied verbatim from
 *     C:\Users\crypt\Documents\Mnemosyne Apps\MnemoBudget on 2026-10-26: three
 *     pockets, one cap of 120 € on « Chien », no rate, no `currencies`), with
 *     the folder empty as it is on disk, then with the line §13.6 describes;
 *   - the far view WITHOUT a cap (the existing far test has one);
 *   - a HIDDEN frame (requestAnimationFrame never fires) with motion ON, which
 *     is the case §13.4 marks 🚨 and which jsdom's missing matchMedia hides
 *     from every other test;
 *   - the error state reached by an agent call;
 *   - a narrow window (the rail must leave when the bottom bar arrives);
 *   - a month that has not happened yet;
 *   - the same month read from two doors (dashboard, history).
 *
 * A red case here is a finding, not a broken probe: each assertion states the
 * rule as the doc writes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
import { adoptHostZoom } from './components/distance';
import { setLangMode } from './i18n';

const nb = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const T0 = '2026-10-24T18:57:00.000Z';

/** Tony's settings.json, verbatim (2026-10-26). */
const REAL_SETTINGS = {
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
const MAISON = 'p_mvmpikbcb317cf653346';
const COURSES = 'c_mvmpikbc806f43ab117a';
const CHIEN = 'c_mvmpikbc01c456208512';

const realSettings = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...REAL_SETTINGS, ...extra });
/** The line §13.6 saw on screen: « Courses, à vérifier, 45,00 € », written by the orb. */
const line136 = JSON.stringify({ id: 'e_orb45', status: 'paid', amountCents: 4500, currency: 'EUR', day: '2026-10-24', pocketId: MAISON, categoryId: COURSES, label: 'courses', origin: 'agent', review: true, createdAt: T0, updatedAt: T0 });
const paid = (id: string, amountCents: number, day: string, categoryId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, status: 'paid', amountCents, currency: 'EUR', day, pocketId: MAISON, categoryId, origin: 'typed', createdAt: T0, updatedAt: T0, ...extra });

/** A DOM that answers media queries: motion ON (the real iframe), `narrow` as asked. */
function installMatchMedia(opts: { narrow?: boolean } = {}) {
  const mm = (query: string) => ({
    matches: query.includes('max-width') ? !!opts.narrow : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: mm });
}

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.folder = '/home/a/Budget';
  h.handlers = {};
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

afterEach(() => {
  adoptHostZoom(1);
  // Back to the DOM the other suites see: no matchMedia at all.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
});

async function openBudget() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
  await screen.findByTestId('figure-spent');
}

describe('A. the real folder, as it is on disk (settings.json only, 2026-10-26)', () => {
  it('cap 120 € on Chien and nothing spent: the hero says 120,00 € left, 0 %, no comparison, nothing to rank, three pockets on the strip', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    await openBudget();
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('120,00 €');
    expect(screen.getByText('0 %')).toBeInTheDocument();
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('0,00 €');
    // Last month at the same point: 0,00 € and NO percentage against a month of zero (🎭 §13.3).
    expect(document.querySelector('.b-delta')).toBeNull();
    const shares = screen.getByRole('heading', { name: "Où va l'argent" }).closest('section')!;
    expect(within(shares).getByText('Aucune dépense ce mois-ci.')).toBeInTheDocument();
    const strip = document.querySelector('.b-strip')!;
    expect(within(strip as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Maison'), expect.stringContaining('Famille'), expect.stringContaining('Pro')]));
    expect(screen.getByText('Rien à vérifier.')).toBeInTheDocument();
    // The orb's own sentence on the real settings, with nothing in the folder.
    const read = h.handlers.summary!({}) as { say: string };
    expect(nb(read.say)).toBe('octobre 2026 : 0,00 € dépensés, 0,00 € prévus. Reste 120,00 € sur les budgets.');
  });

  it('with the line §13.6 saw (Courses, à vérifier, 45,00 €): the sentence the doc quotes, and the dashboard counts it', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    await openBudget();
    const read = h.handlers.summary!({}) as { say: string };
    expect(nb(read.say)).toBe('octobre 2026 : 45,00 € dépensés, 0,00 € prévus. Reste 120,00 € sur les budgets. 1 ligne à vérifier.');
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('45,00 €');
    // Courses has no cap: the 120 € of budgets are untouched.
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('120,00 €');
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');
    const shares = screen.getByRole('heading', { name: "Où va l'argent" }).closest('section')!;
    expect(within(shares).getByText(/^Courses/)).toBeInTheDocument();
    expect(within(shares).getByText('100 %')).toBeInTheDocument();
    // The nine categories with nothing spent are not ranked (the real settings have ten).
    expect(shares.querySelectorAll('.b-share')).toHaveLength(1);
  });
});

describe('H. the change-of-base dialog, with the ⇄ swap the suite never presses (§13.2)', () => {
  it('a rate typed after the swap (« 1 MAD = 0,1 EUR ») is read in the direction shown: EUR ends with « 1 EUR = 10 MAD »', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    fireEvent.click(screen.getByRole('button', { name: /^Changer$/ }));
    // The real settings know no other currency: MAD is offered both to change the base and to add a currency; the change-base tiles are the ones under « Changer ».
    const picker = document.querySelector('.b-settings .b-hello-step') as HTMLElement;
    fireEvent.click(within(picker).getByRole('button', { name: /^MAD/ }));
    const ask = await screen.findByRole('alertdialog');
    const field = within(ask).getByRole('textbox', { name: 'Taux entre les deux' });
    // No rate held between EUR and MAD on the real settings: the field is empty and asks.
    expect(field).toHaveValue('');
    fireEvent.click(within(ask).getByRole('button', { name: 'Inverser le sens du taux' }));
    expect(nb(ask.textContent)).toContain('1 MAD =');
    fireEvent.change(field, { target: { value: '0,1' } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Passer en MAD' }));
    await act(async () => { await Promise.resolve(); });
    const saved = JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!);
    expect(saved.baseCurrency).toBe('MAD');
    expect(saved.rates.EUR.value).toBeCloseTo(10, 9);
    expect(saved.pockets[0].categories[2].capCents).toBe(120000);
  });
});

describe('B. the far view (§13.7), on cases the suite never gives it', () => {
  it('🎭 no cap set: the one figure is what was SPENT under « Dépensé », never « reste 0 € »; and ⛔ not one button', async () => {
    const noCaps = { ...REAL_SETTINGS, pockets: REAL_SETTINGS.pockets.map((p) => ({ ...p, categories: p.categories.map(({ capCents: _c, ...c }) => c) })) };
    h.io.files.set('/home/a/Budget/settings.json', JSON.stringify(noCaps));
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    await openBudget();
    await act(async () => { adoptHostZoom(0.5); });
    const far = await screen.findByTestId('glance-far');
    expect(within(far).getByText(/^Dépensé/)).toBeInTheDocument();
    expect(nb(screen.getByTestId('glance-figure').textContent)).toBe('45,00 €');
    expect(within(far).getByText('Aucun budget fixé')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('🎭 rule 5 from across the board: a line without a rate puts « ≥ » on the spent figure', async () => {
    const noCaps = { ...REAL_SETTINGS, pockets: REAL_SETTINGS.pockets.map((p) => ({ ...p, categories: p.categories.map(({ capCents: _c, ...c }) => c) })) };
    h.io.files.set('/home/a/Budget/settings.json', JSON.stringify(noCaps));
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    h.io.files.set('/home/a/Budget/entries/gbp.json', paid('gbp', 2000, '2026-10-20', COURSES, { currency: 'GBP' }));
    await openBudget();
    await act(async () => { adoptHostZoom(0.5); });
    await screen.findByTestId('glance-far');
    expect(nb(screen.getByTestId('glance-figure').textContent)).toBe('≥ 45,00 €');
  });

  it('⛔ with a cap, still not one button (the orb is the host\'s); « ≤ » when a capped category holds a line without a rate', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/dog.json', paid('dog', 3000, '2026-10-10', CHIEN));
    h.io.files.set('/home/a/Budget/entries/dogmad.json', paid('dogmad', 10000, '2026-10-12', CHIEN, { currency: 'MAD' }));
    await openBudget();
    await act(async () => { adoptHostZoom(0.5); });
    const far = await screen.findByTestId('glance-far');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(within(far).getByText(/^Reste sur les budgets/)).toBeInTheDocument();
    expect(nb(screen.getByTestId('glance-figure').textContent)).toBe('≤ 90,00 €');
  });
});

// C. (a month that has not happened yet) and D1. (one month, two doors) are RED findings:
// they live in App.verif-177-13.red.probe.test.tsx so this file stays green for the mutation replay.

describe('D0. the six-month trend (§13.1, rule 5)', () => {
  it('a month holding a line without a rate carries « ≥ » on its column, written in its label too (found tooltip-only by the pass, fixed)', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    h.io.files.set('/home/a/Budget/entries/gbp.json', paid('gbp', 2000, '2026-10-20', COURSES, { currency: 'GBP' }));
    await openBudget();
    const current = document.querySelector('.b-trend-col.current');
    expect(current).not.toBeNull();
    expect(nb(current!.getAttribute('title'))).toMatch(/^oct\. : ≥ 45,00 €/);
    // Written, not only hovered: a touch never hovers.
    expect(nb(current!.textContent)).toBe('≥ oct.');
  });
});

describe('D. the history (§13.1)', () => {
  it('the history\'s totals are sums over the lines SHOWN (§13.1): a filter changes them', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/e_orb45.json', line136);
    h.io.files.set('/home/a/Budget/entries/dog.json', paid('dog', 3000, '2026-10-10', CHIEN));
    h.io.files.set('/home/a/Budget/entries/plan.json', paid('plan', 30000, '2026-10-28', COURSES, { status: 'planned' }));
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    expect(nb(screen.getByRole('heading', { name: /3 lignes/ }).closest('.b-card-head')!.textContent)).toContain('Dépensé 75,00 €');
    fireEvent.change(screen.getByRole('textbox', { name: /Rechercher/ }), { target: { value: 'chien' } });
    const head = screen.getByRole('heading', { name: /1 ligne$/ }).closest('.b-card-head')!;
    expect(nb(head.textContent)).toContain('Dépensé 30,00 €');
    expect(nb(head.textContent)).toContain('Prévu 0,00 €');
  });
});

describe('E. the error state reached by an agent call (§13.6)', () => {
  it('a settings.json that is not settings: the person sees the error screen and the orb hears « Le budget ne se lit pas », never « choisissez un dossier »', async () => {
    h.io.files.set('/home/a/Budget/settings.json', '{ not: json');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le budget ne se lit pas');
    expect(() => h.handlers.summary!({})).toThrow(/^TO_PERSON: Le budget ne se lit pas$/);
    await expect(h.handlers.addExpense!({ amount: 20, pocket: 'maison' }) as Promise<unknown>).rejects.toThrow(/^TO_PERSON: Le budget ne se lit pas$/);
    expect([...h.io.files.keys()].filter((k) => k.includes('/entries/'))).toEqual([]);
  });
});

describe('F. a hidden frame, motion ON (§13.4 🚨): no animation frame ever comes', () => {
  let cancelled: ReturnType<typeof vi.fn>;
  /** Each frame asked, by id → how many arguments its callback takes (the count-up's `tick(now)` takes one, a reveal takes none). */
  const kinds = new Map<number, number>();
  beforeEach(() => {
    installMatchMedia();
    kinds.clear();
    let n = 0;
    // A hidden iframe gets 0 rAF/s (measured in the embedded browser): the callback is never called.
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: vi.fn((cb: (t: number) => void) => { n += 1; kinds.set(n, cb.length); return n; }) });
    cancelled = vi.fn();
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: cancelled });
  });

  async function mountWithSpending() {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    h.io.files.set('/home/a/Budget/entries/dog.json', paid('dog', 4500, '2026-10-10', CHIEN));
    const view = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
    await screen.findByTestId('figure-remaining');
    return view;
  }
  const bar = () => (document.querySelector('.b-hero .b-bar > i:last-child') as HTMLElement).style.width;

  it('the money figure is not left at 0 and the bar not left empty: both settle within a second', async () => {
    await mountWithSpending();
    // Right after mount: the count-up has not started (no frame), the bar is drawn from empty.
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('0,00 €');
    expect(bar()).toBe('0%');
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('75,00 €');
    expect(bar()).toBe('37.5%');
  }, 10000);

  it('rule 13: a window that leaves before its figure settled cancels the count-up frame it asked for', async () => {
    const view = await mountWithSpending();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('0,00 €');
    view.unmount();
    const countUpFrames = cancelled.mock.calls.map(([id]) => id as number).filter((id) => kinds.get(id) === 1);
    expect(countUpFrames.length).toBeGreaterThan(0);
  }, 10000);
});

describe('G. the window shape (§13.4, §13.7)', () => {
  it('narrow (under 900 px): the bottom bar is there and the rail is NOT; never both in the DOM', async () => {
    installMatchMedia({ narrow: true });
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    await openBudget();
    expect(document.querySelector('nav.b-tabbar')).not.toBeNull();
    expect(document.querySelector('aside.b-side')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Tableau de bord' })).toHaveLength(1);
  });

  it('a tall window 540 × 900 keeps its screens with the bottom bar (found as a tile by the pass; the tile is for a window small both ways)', async () => {
    h.io.files.set('/home/a/Budget/settings.json', realSettings());
    await openBudget();
    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 540 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByTestId('glance-mini')).toBeNull();
    expect(screen.getByRole('button', { name: 'Historique' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réglages' })).toBeInTheDocument();
  });
});
