/**
 * The screens of the 2026-10-26 redesign, mounted against a host made of an
 * in-memory folder: the main currency chosen on the welcome screen, a change
 * of main currency that converts caps and rates with the rate the person
 * gives, the line dialog that says what a foreign amount counts for, the
 * history's filters and search, and a deletion asked in the app's own dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const nb = (s: string | null) => (s ?? '').replace(/\s/g, ' ');
const T0 = '2026-10-03T10:00:00.000Z';
const settingsFile = (extra: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, baseCurrency: 'EUR', memory: false, rates: {},
  pockets: [
    { id: 'home', name: 'Maison', icon: '🏠', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }] },
    { id: 'kids', name: 'Enfants', icon: '👧', categories: [{ id: 'school', name: 'École' }] },
  ],
  ...extra,
});
const entryFile = (id: string, amountCents: number, day: string, pocketId: string, categoryId: string, label: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, status: 'paid', amountCents, currency: 'EUR', day, pocketId, categoryId, label, origin: 'typed', createdAt: T0, updatedAt: T0, ...extra });

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.folder = '/home/a/Budget';
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

const WIDTH = window.innerWidth;
const HEIGHT = window.innerHeight;
const sizeWindow = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h });
};
afterEach(() => {
  // The far store and the window size are global: a failed assertion must not leave the next test far or mini.
  adoptHostZoom(1);
  sizeWindow(WIDTH, HEIGHT);
});

async function openBudget() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
  await screen.findByTestId('figure-spent');
}

describe('the main currency', () => {
  it('is chosen on the welcome screen: a new budget counts in MAD from its first figure', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^MAD/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choisir un dossier/ }));
    await screen.findByTestId('figure-spent');
    expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).baseCurrency).toBe('MAD');
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('0,00 MAD');
  });

  it('🚨 changing it asks the rate, offers the one already held, and converts the caps and the rates with it (rule 4)', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile({ rates: { MAD: { value: 0.1, day: '2026-10-20' } } }));
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    fireEvent.click(screen.getByRole('button', { name: /^Changer$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^MAD/ }));
    const ask = await screen.findByRole('alertdialog');
    expect(within(ask).getByRole('textbox', { name: 'Taux entre les deux' })).toHaveValue('10');
    expect(within(ask).getByText(/taux déjà saisi le 20 oct/)).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole('button', { name: 'Passer en MAD' }));
    await waitFor(() => expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).baseCurrency).toBe('MAD'));
    const saved = JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!);
    expect(saved.rates).toEqual({ EUR: { value: 10, day: '2026-10-20' } });
    expect(saved.pockets[0].categories[0].capCents).toBe(120000);
    expect(saved.pockets[0].categories[1].capCents).toBeUndefined();
    expect(saved.currencies).toEqual(['EUR']);
  });

  it('a rate typed the other way round (« 1 EUR = 10,8 MAD ») is kept base-per-unit and shown the way it was typed', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile({ currencies: ['MAD'] }));
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(screen.getByText('sans taux')).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Taux de MAD' });
    fireEvent.change(field, { target: { value: '0,092' } });
    fireEvent.blur(field);
    await waitFor(() => expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).rates.MAD).toEqual({ value: 0.092, day: '2026-10-24' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inverser le sens du taux' }));
    await waitFor(() => expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).rates.MAD.typedAsBase).toBe(true));
    expect(screen.getByRole('textbox', { name: 'Taux de MAD' })).toHaveValue('10,8696');
  });
});

describe('a line in another currency', () => {
  it('said to the orb for the first time (« 80 dirhams »), its currency joins the tiles the dialog offers', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    await openBudget();
    await act(async () => { await h.handlers.addExpense!({ amount: 80, currency: 'dirhams', pocket: 'maison', category: 'chien' }); });
    expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).currencies).toEqual(['MAD']);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une dépense/ }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^MAD/ })).toBeInTheDocument();
  });

  it('says what it will count for through the rate, and that it is counted apart without one', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile({ rates: { MAD: { value: 0.1, day: '2026-10-20' } } }));
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une dépense/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^MAD/ }));
    expect(nb(within(dialog).getByText(/au taux du 20 oct/).textContent)).toContain('≈ 100,00 €');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Autre/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Code de la devise' }), { target: { value: 'GBP' } });
    expect(within(dialog).getByText(/Pas de taux pour GBP/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByText(/1 ligne en GBP sans taux/)).toBeInTheDocument());
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('≥ 0,00 €');
    // The currency used joins the tiles offered next time.
    expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).currencies).toEqual(['GBP']);
  });
});

describe('the history', () => {
  it('filters the month by kind and pocket, searches the words, and counts what is shown', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    h.io.files.set('/home/a/Budget/entries/a.json', entryFile('a', 8000, '2026-10-03', 'home', 'dog', 'Croquettes'));
    h.io.files.set('/home/a/Budget/entries/b.json', entryFile('b', 1050, '2026-10-10', 'home', 'food', 'Courses'));
    h.io.files.set('/home/a/Budget/entries/c.json', entryFile('c', 30000, '2026-10-28', 'kids', 'school', 'Noël', { status: 'planned' }));
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    expect(screen.getByRole('heading', { name: /3 lignes/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Prévu/ }));
    expect(screen.getByRole('heading', { name: /1 ligne$/ })).toBeInTheDocument();
    expect(screen.getByText('Noël')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Tout / }));
    fireEvent.click(screen.getByRole('button', { name: /Enfants/ }));
    expect(screen.getByRole('heading', { name: /1 ligne$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Toutes les poches/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Rechercher/ }), { target: { value: 'croq' } });
    expect(screen.getByRole('heading', { name: /1 ligne$/ })).toBeInTheDocument();
    expect(screen.getByText('Croquettes')).toBeInTheDocument();
    expect(screen.queryByText('Courses')).toBeNull();
  });
});

describe('deleting a line', () => {
  it('asks in the app\'s own dialog, never the browser\'s, and only then the file leaves the folder (rule 6)', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    h.io.files.set('/home/a/Budget/entries/a.json', entryFile('a', 8000, '2026-10-03', 'home', 'dog', 'Croquettes'));
    const native = vi.spyOn(window, 'confirm');
    await openBudget();
    // The dashboard no longer lists the paid lines (one screen, no scroll): the history does.
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Corriger' })[0]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Supprimer/ }));
    expect(h.io.files.has('/home/a/Budget/entries/a.json')).toBe(true);
    const ask = screen.getByRole('alertdialog');
    fireEvent.click(within(ask).getByRole('button', { name: /Supprimer/ }));
    await waitFor(() => expect(h.io.files.has('/home/a/Budget/entries/a.json')).toBe(false));
    expect(native).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Tableau de bord' }));
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('0,00 €');
  });
});

describe('from across the board, and in a small window', () => {
  it('zoomed out past 0.7, the window is one figure and no rail; back at 1, the screens return', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    h.io.files.set('/home/a/Budget/entries/a.json', entryFile('a', 8000, '2026-10-03', 'home', 'dog', 'Croquettes'));
    await openBudget();
    await act(async () => { adoptHostZoom(0.5); });
    expect(await screen.findByTestId('glance-far')).toBeInTheDocument();
    // 120 € cap on Chien, 80 € spent: 40 € left, the one thing to read.
    expect(nb(screen.getByTestId('glance-figure').textContent)).toBe('40,00 €');
    expect(screen.queryByRole('button', { name: 'Tableau de bord' })).toBeNull();
    await act(async () => { adoptHostZoom(1); });
    expect(await screen.findByRole('button', { name: 'Tableau de bord' })).toBeInTheDocument();
    expect(screen.queryByTestId('glance-far')).toBeNull();
  });

  it('a window small both ways (under 560 × 640) is a tile: the figure and a « + », nothing to navigate; narrow but tall keeps its screens', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    await openBudget();
    // A phone's shape: narrow and tall. The screens stay (the bottom bar lives there).
    await act(async () => { sizeWindow(400, 900); window.dispatchEvent(new Event('resize')); });
    expect(screen.queryByTestId('glance-mini')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tableau de bord' })).toBeInTheDocument();
    await act(async () => { sizeWindow(400, 360); window.dispatchEvent(new Event('resize')); });
    expect(await screen.findByTestId('glance-mini')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tableau de bord' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une dépense' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { sizeWindow(WIDTH, HEIGHT); window.dispatchEvent(new Event('resize')); });
    expect(await screen.findByRole('button', { name: 'Tableau de bord' })).toBeInTheDocument();
  });
});

describe('the dashboard', () => {
  it('compares with the same point of last month as a percentage, and ranks where the money goes', async () => {
    h.io.files.set('/home/a/Budget/settings.json', settingsFile());
    h.io.files.set('/home/a/Budget/entries/a.json', entryFile('a', 8000, '2026-10-03', 'home', 'dog', 'Croquettes'));
    h.io.files.set('/home/a/Budget/entries/b.json', entryFile('b', 2000, '2026-10-10', 'home', 'food', 'Courses'));
    h.io.files.set('/home/a/Budget/entries/c.json', entryFile('c', 5000, '2026-09-20', 'home', 'dog', 'Croquettes'));
    h.io.files.set('/home/a/Budget/entries/d.json', entryFile('d', 4000, '2026-09-30', 'home', 'dog', 'Vétérinaire'));
    await openBudget();
    // Up to the 24th: 100 € now against 50 € then (the 30th is past the same point): +100 %.
    expect(screen.getByText('+100 %')).toBeInTheDocument();
    expect(screen.getByText("jusqu'au 24")).toBeInTheDocument();
    const shares = screen.getByRole('heading', { name: "Où va l'argent" }).closest('section')!;
    const names = within(shares).getAllByText(/^(Chien|Courses)/).map((el) => el.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^Chien/);
    expect(names[1]).toMatch(/^Courses/);
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('40,00 €');
  });
});
