/**
 * The cartridge MOUNTED against a host made of an in-memory folder: the five
 * states, the starter pockets written once, a line typed by hand, a line the
 * orb writes (it waits in « À vérifier », its spoken line is the app's sum),
 * confirming it, and a refused save that never shows a line not on disk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryIO } from './test/memoryIO';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
const h = vi.hoisted(() => ({
  io: null as unknown as ReturnType<typeof import('./test/memoryIO').memoryIO>,
  handlers: {} as Handlers,
  folder: '/home/a/Budget' as string | null,
  remembered: null as string | null,
  ingested: [] as string[],
  /** The folder the OS proposes (dialog.appFolder); null = an older host without it. */
  proposed: null as string | null,
  created: [] as string[],
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
  sdk: {
    onAgentActions: (handlers: Handlers) => {
      h.handlers = handlers;
      return { ready: Promise.resolve(), off: () => {} };
    },
  },
  deleteFile: vi.fn(async (p: string) => { h.io.files.delete(p); }),
  pickFolder: vi.fn(async () => h.folder),
  appFolder: vi.fn(async (create: boolean) => {
    if (!h.proposed) throw new Error('UNKNOWN_ACTION');
    if (create) { h.created.push(h.proposed); await h.io.mkdir(h.proposed); }
    return h.proposed;
  }),
  openFolderInOS: vi.fn(async () => ({ success: true })),
  readRememberedFolder: () => h.remembered,
  readMirroredFolder: vi.fn(async () => null),
  rememberFolder: vi.fn(async (f: string) => { h.remembered = f; }),
  ensureSandbox: vi.fn(async () => ({ vault: 'APP-mnemo-budget', unlocked: false })),
  rememberLine: vi.fn(async (content: string) => { h.ingested.push(content); }),
}));

import App from './App';
import { setLangMode } from './i18n';

const nb = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.handlers = {};
  h.folder = '/home/a/Budget';
  h.remembered = null;
  h.ingested = [];
  h.proposed = null;
  h.created = [];
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

async function openBudget() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
  await screen.findByTestId('figure-spent');
}

describe('MnemoBudget on screen', () => {
  it('no folder yet: it asks for one, with an example of what to say', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /Choisir un dossier/ })).toBeInTheDocument();
    expect(screen.getByText(/croquettes pour le chien/)).toBeInTheDocument();
  });

  it('the OS proposes its folder: « OK » creates it, opens it and remembers it (doc 177 §12)', async () => {
    h.proposed = '/home/a/Documents/Mnemosyne Apps/MnemoBudget';
    render(<App />);
    expect(await screen.findByTestId('proposed-folder')).toHaveTextContent('/home/a/Documents/Mnemosyne Apps/MnemoBudget');
    expect(screen.getByText('Ce dossier va être créé :')).toBeInTheDocument();
    expect(h.created).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^OK$/ }));
    await screen.findByTestId('figure-spent');
    expect(h.created).toEqual(['/home/a/Documents/Mnemosyne Apps/MnemoBudget']);
    expect(h.remembered).toBe('/home/a/Documents/Mnemosyne Apps/MnemoBudget');
    expect(h.io.files.has('/home/a/Documents/Mnemosyne Apps/MnemoBudget/settings.json')).toBe(true);
  });

  it('« Choisir un autre dossier » still opens the picker, and nothing is created', async () => {
    h.proposed = '/home/a/Documents/Mnemosyne Apps/MnemoBudget';
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Choisir un autre dossier/ }));
    await screen.findByTestId('figure-spent');
    expect(h.created).toEqual([]);
    expect(h.remembered).toBe('/home/a/Budget');
  });

  it('a new folder gets the starter pockets, written once to settings.json', async () => {
    await openBudget();
    const settings = JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!);
    expect(settings.pockets.map((p: { name: string }) => p.name)).toEqual(['Maison', 'Famille', 'Pro']);
    expect(screen.getByRole('button', { name: /Maison/ })).toBeInTheDocument();
    expect(screen.getByTestId('figure-remaining')).toHaveTextContent('Aucun budget fixé');
  });

  it('🚨 a settings.json that is not budget settings is left intact and said, never replaced by defaults', async () => {
    h.io.files.set('/home/a/Budget/settings.json', '{"hello":1}');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/laissé tel quel/);
    expect(h.io.files.get('/home/a/Budget/settings.json')).toBe('{"hello":1}');
  });

  it('a line typed by hand is on disk, in the figures, and not to review', async () => {
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une dépense/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '45,50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('45,50 €'));
    const files = [...h.io.files.keys()].filter((k) => k.includes('/entries/'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(h.io.files.get(files[0]!)!)).toMatchObject({ amountCents: 4550, origin: 'typed', status: 'paid' });
    expect(JSON.parse(h.io.files.get(files[0]!)!).review).toBeUndefined();
    expect(screen.queryByTestId('review-count')).toBeNull();
  });

  it('a bad amount is said and nothing is written', async () => {
    await openBudget();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une dépense/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: 'quatre' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Montant attendu/);
    expect([...h.io.files.keys()].filter((k) => k.includes('/entries/'))).toEqual([]);
  });

  it('the orb writes a line: on screen, to review, and its spoken line is the app\'s own sum', async () => {
    await openBudget();
    let answer: { say?: string } = {};
    await act(async () => {
      answer = await h.handlers.addExpense!({ amount: 80, category: 'chien', label: 'croquettes' }) as { say: string };
    });
    expect(nb(answer.say ?? '')).toBe('Noté : 80,00 € croquettes, Chien (Maison), à vérifier.');
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('80,00 €');
    // Confirmed by a person: off the list.
    fireEvent.click(screen.getByRole('button', { name: 'À vérifier' }));
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(screen.queryByTestId('review-count')).toBeNull());
    expect(screen.getByText('Rien à vérifier.')).toBeInTheDocument();
  });

  it('🚨 while the folder is still being read, an agent call is a wait (NOT_READY), never « choose a folder » (field, 2026-10-26)', async () => {
    h.remembered = '/home/a/Budget';
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const listing = h.io.readDir.bind(h.io);
    h.io.readDir = async (p: string) => { await gate; return listing(p); };
    render(<App />);
    await screen.findByText('Lecture du budget…');
    await act(async () => { await Promise.resolve(); });
    await expect(h.handlers.addExpense!({ amount: 20, pocket: 'maison' }) as Promise<unknown>).rejects.toThrow(/^NOT_READY/);
    open();
    await screen.findByTestId('figure-spent');
    // The same call, once the folder is read: served.
    let answer: { say?: string } = {};
    await act(async () => { answer = await h.handlers.addExpense!({ amount: 20, pocket: 'maison' }) as { say: string }; });
    expect(answer.say).toMatch(/^Noté/);
  });

  it('the orb asks for the pocket when the words name none', async () => {
    await openBudget();
    await expect(h.handlers.addExpense!({ amount: 30 }) as Promise<unknown>).rejects.toThrow(/^TO_PERSON: Maison, Famille, Pro : dans quelle poche \?$/);
    expect([...h.io.files.keys()].filter((k) => k.includes('/entries/'))).toEqual([]);
  });

  it('summary answers with the sums and shows the month', async () => {
    await openBudget();
    await act(async () => { await h.handlers.addExpense!({ amount: 12.5, pocket: 'maison', category: 'courses' }); });
    const read = h.handlers.summary!({}) as { say: string; spentCents: number };
    expect(read.spentCents).toBe(1250);
    expect(nb(read.say)).toContain('12,50 € dépensés');
  });

  it('🚨 a refused write never shows the line, and the reason is on screen', async () => {
    await openBudget();
    h.io.writeFile = async () => ({ success: false, error: 'EACCES' });
    await act(async () => {
      await expect(h.handlers.addExpense!({ amount: 9, pocket: 'maison' }) as Promise<unknown>).rejects.toThrow(/WRITE_FAILED/);
    });
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('0,00 €');
    expect(screen.getByRole('alert')).toHaveTextContent(/EACCES/);
  });

  it('a confirmed paid line goes to memory only when memory is on', async () => {
    await openBudget();
    await act(async () => { await h.handlers.addExpense!({ amount: 20, pocket: 'maison', category: 'chien' }); });
    fireEvent.click(screen.getByRole('button', { name: 'À vérifier' }));
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(h.ingested).toHaveLength(1));
    expect(h.ingested[0]).toMatch(/^MnemoBudget · 2026-10-24 · Maison › Chien · 20,00 € \(EUR\)$/);
  });

  it('🚨 a line still to review never enters memory, and nothing does with memory off (verifier M18, M19)', async () => {
    await openBudget();
    await act(async () => { await h.handlers.addExpense!({ amount: 20, pocket: 'maison', category: 'chien' }); });
    expect(h.ingested).toEqual([]);
    const settings = JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!);
    h.io.files.set('/home/a/Budget/settings.json', JSON.stringify({ ...settings, memory: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mettre les lignes validées en mémoire/ }));
    await waitFor(() => expect(JSON.parse(h.io.files.get('/home/a/Budget/settings.json')!).memory).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'À vérifier' }));
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(screen.queryByTestId('review-count')).toBeNull());
    expect(h.ingested).toEqual([]);
  });

  it('a line without a rate makes the total a floor (≥), and a converted currency shows its rate and day (verifier M06, rule 4)', async () => {
    const T0 = '2026-10-03T10:00:00.000Z';
    h.io.files.set('/home/a/Budget/settings.json', JSON.stringify({
      version: 1, baseCurrency: 'EUR', memory: false, rates: { MAD: { value: 0.1, day: '2026-10-20' } },
      pockets: [{ id: 'kids', name: 'Enfants', categories: [] }],
    }));
    const line = (id: string, amountCents: number, currency: string) => JSON.stringify({ id, status: 'paid', amountCents, currency, day: '2026-10-03', pocketId: 'kids', origin: 'typed', createdAt: T0, updatedAt: T0 });
    h.io.files.set('/home/a/Budget/entries/a.json', line('a', 100000, 'MAD'));
    h.io.files.set('/home/a/Budget/entries/b.json', line('b', 5000, 'USD'));
    await openBudget();
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('≥ 100,00 €');
    expect(screen.getByText(/1 ligne en USD sans taux/)).toBeInTheDocument();
    expect(nb(screen.getByText(/1 MAD = 0,1 EUR/).textContent)).toMatch(/taux du 20 oct/);
  });
});
