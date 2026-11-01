/**
 * Till receipts read off their photos (doc 177 §14), against a host made of
 * an in-memory folder and a fake OCR engine: a photo dropped here IS its
 * text (the engine returns the bytes the photo was saved with). A ticket
 * that says everything is written to « À vérifier » with its photo; one that
 * names no category opens the line dialog with what was read and the
 * category asked; no OCR engine stops the loop and offers Settings › OCR; a
 * HEIC is refused by its name before anything is sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryIO } from './test/memoryIO';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
const h = vi.hoisted(() => ({
  io: null as unknown as ReturnType<typeof import('./test/memoryIO').memoryIO>,
  folder: '/home/a/Budget' as string | null,
  /** What the engine reads on each photo path: a saved photo's own bytes, or a text seeded for a picked path. */
  texts: {} as Record<string, string>,
  /** False = no OCR engine installed on this machine. */
  engine: true,
  /** False = an older host without `reader.ocrStatus`: the question cannot be asked, the reading says it. */
  engineKnown: true,
  picked: null as string | null,
  settingsOpened: 0,
  saved: [] as string[],
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
  sdk: { onAgentActions: (_handlers: Handlers) => ({ ready: Promise.resolve(), off: () => {} }) },
  deleteFile: vi.fn(async () => {}),
  pickFolder: vi.fn(async () => h.folder),
  appFolder: vi.fn(async () => { throw new Error('UNKNOWN_ACTION'); }),
  openFolderInOS: vi.fn(async () => ({ success: true })),
  readRememberedFolder: () => null,
  readMirroredFolder: vi.fn(async () => null),
  rememberFolder: vi.fn(async () => {}),
  ensureSandbox: vi.fn(async () => ({ vault: 'APP-mnemo-budget', unlocked: false })),
  rememberLine: vi.fn(async () => {}),
}));

vi.mock('./data/receipts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./data/receipts')>();
  const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  const fake: typeof real.hostReceipts = {
    pickImage: async () => h.picked,
    saveImage: async (name: string, base64: string) => {
      const path = `/home/a/Apps/MnemoBudget/receipts/${name}`;
      h.saved.push(path);
      h.texts[path] = decode(base64);
      return path;
    },
    readText: async (path: string) => {
      // The host's own sentence, the same with no engine and with an engine that read nothing.
      if (!h.engine) throw real.readError(new Error('No text found in image. Install an OCR engine in Settings → OCR to read images and scanned PDFs.'));
      const text = h.texts[path];
      if (text === undefined) throw new real.ReceiptError('NO_TEXT');
      return text;
    },
    ocrInstalled: async () => (h.engineKnown ? h.engine : null),
    openOcrSettings: async () => { h.settingsOpened++; },
    openInOS: async () => {},
  };
  return { ...real, hostReceipts: fake };
});

import App from './App';
import { setLangMode } from './i18n';

const nb = (s: string | null) => (s ?? '').replace(/\s/g, ' ');
const settingsFile = () => JSON.stringify({
  version: 1, baseCurrency: 'EUR', memory: false, rates: {},
  pockets: [
    { id: 'home', name: 'Maison', icon: '🏠', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }] },
    { id: 'kids', name: 'Enfants', icon: '👧', categories: [{ id: 'school', name: 'École' }] },
  ],
});
const CARREFOUR = 'CARREFOUR MARKET\n24/10/2026 12:31\nLAIT 1,05\nTOTAL TTC 35,10\nCB 35,10';
const BISTRO = 'LE PETIT BISTRO\n24/10/2026 20:45\nMenu 38,00\nTotal 48,90 EUR';
/** A « photo » of a ticket: its bytes are the text the engine will read. */
const photo = (name: string, text = 'x') => new File([text], name, { type: 'image/jpeg' });

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.folder = '/home/a/Budget';
  h.texts = {};
  h.engine = true;
  h.engineKnown = true;
  h.picked = null;
  h.settingsOpened = 0;
  h.saved = [];
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

async function openBudget() {
  h.io.files.set('/home/a/Budget/settings.json', settingsFile());
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
  await screen.findByTestId('figure-spent');
}

async function openReceipts() {
  fireEvent.click(screen.getByRole('button', { name: /Tickets/ }));
  return screen.getByRole('dialog', { name: 'Lire des tickets' });
}

const drop = (zone: HTMLElement, files: File[]) => fireEvent.drop(zone, { dataTransfer: { files } });
const entryFiles = () => [...h.io.files.keys()].filter((k) => k.includes('/entries/'));
const entryAt = (i: number) => JSON.parse(h.io.files.get(entryFiles()[i]!)!);

describe('a receipt read whole', () => {
  it('lands in « À vérifier » with its amount, its day, its merchant, its category and its photo', async () => {
    await openBudget();
    const dialog = await openReceipts();
    drop(within(dialog).getByTestId('receipt-drop'), [photo('carrefour.jpg', CARREFOUR)]);
    await waitFor(() => expect(within(dialog).getByText(/Noté, à vérifier : 35,10\s€ CARREFOUR MARKET, Courses \(Maison\)/)).toBeInTheDocument());
    expect(entryFiles()).toHaveLength(1);
    const line = entryAt(0);
    expect(line).toMatchObject({ amountCents: 3510, currency: 'EUR', day: '2026-10-24', pocketId: 'home', categoryId: 'food', label: 'CARREFOUR MARKET', origin: 'scan', review: true });
    expect(h.saved).toHaveLength(1);
    expect(line.receipt).toBe(h.saved[0]);
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');
  });
});

describe('a receipt that names no category', () => {
  it('opens the line dialog with what was read, the category asked; saved by the person, it is a scan line not to review', async () => {
    await openBudget();
    const dialog = await openReceipts();
    drop(within(dialog).getByTestId('receipt-drop'), [photo('bistro.jpg', BISTRO)]);
    const form = await screen.findByRole('dialog', { name: 'Nouvelle ligne' });
    expect(within(form).getByLabelText('Montant')).toHaveValue('48,90');
    expect(within(form).getByTestId('scan-note')).toHaveTextContent(/Lu sur le ticket bistro.jpg/);
    expect(within(form).getByTestId('scan-note')).toHaveTextContent(/ne dit pas la catégorie/);
    fireEvent.click(within(form).getByRole('button', { name: 'Courses' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(within(dialog).getByText(/À compléter : bistro.jpg/)).toBeInTheDocument());
    const line = entryAt(0);
    expect(line).toMatchObject({ amountCents: 4890, day: '2026-10-24', categoryId: 'food', origin: 'scan', label: 'LE PETIT BISTRO' });
    expect(line.receipt).toBe(h.saved[0]);
    expect(line.review).toBeUndefined();
    expect(screen.queryByTestId('review-count')).toBeNull();
  });

  it('closed without saving, the receipt is skipped and nothing is written', async () => {
    await openBudget();
    const dialog = await openReceipts();
    drop(within(dialog).getByTestId('receipt-drop'), [photo('bistro.jpg', BISTRO)]);
    const form = await screen.findByRole('dialog', { name: 'Nouvelle ligne' });
    fireEvent.click(within(form).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(within(dialog).getByText(/Passé : bistro.jpg/)).toBeInTheDocument());
    expect(entryFiles()).toEqual([]);
  });
});

describe('what stops a reading', () => {
  it('the host says no OCR engine is installed: the question comes BEFORE any photo, with Settings › OCR, and nothing can be dropped', async () => {
    h.engine = false;
    await openBudget();
    const dialog = await openReceipts();
    const ask = await within(dialog).findByTestId('engine-ask');
    expect(ask).toHaveTextContent(/Aucun moteur de lecture d'images n'est installé/);
    expect(within(dialog).queryByTestId('receipt-drop')).toBeNull();
    fireEvent.click(within(ask).getByRole('button', { name: /Installer dans Réglages › OCR/ }));
    expect(h.settingsOpened).toBe(1);
    expect(h.saved).toEqual([]);
    // Back from Settings with the engine installed: « Vérifier à nouveau » brings the drop zone.
    h.engine = true;
    fireEvent.click(within(ask).getByRole('button', { name: 'Vérifier à nouveau' }));
    expect(await within(dialog).findByTestId('receipt-drop')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('engine-ask')).toBeNull();
  });

  it('an older host cannot say whether an engine is installed: each photo read empty is said unread, the loop goes on, Settings › OCR is offered once', async () => {
    h.engine = false;
    h.engineKnown = false;
    await openBudget();
    const dialog = await openReceipts();
    drop(within(dialog).getByTestId('receipt-drop'), [photo('a.jpg'), photo('b.jpg')]);
    await waitFor(() => expect(within(dialog).getByText(/Pas lu : b.jpg \(aucun texte lisible\)/)).toBeInTheDocument());
    expect(within(dialog).getByText(/Pas lu : a.jpg \(aucun texte lisible\)/)).toBeInTheDocument();
    const banners = within(dialog).getAllByRole('alert');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(/Sans moteur de lecture d'images installé/);
    fireEvent.click(within(banners[0]!).getByRole('button', { name: /Installer dans Réglages › OCR/ }));
    expect(h.settingsOpened).toBe(1);
    // Both photos were tried: one unreadable photo never stops the others.
    expect(h.saved).toHaveLength(2);
    expect(entryFiles()).toEqual([]);
  });

  it('a HEIC is refused by its name, before anything is sent', async () => {
    await openBudget();
    const dialog = await openReceipts();
    drop(within(dialog).getByTestId('receipt-drop'), [photo('IMG_0001.HEIC')]);
    expect(await within(dialog).findByText(/Pas lu : IMG_0001.HEIC \(pas une photo/)).toBeInTheDocument();
    expect(h.saved).toEqual([]);
  });

  it('the OS picker: a path chosen is read in place, never copied', async () => {
    await openBudget();
    h.picked = '/home/a/Pictures/ticket.png';
    h.texts[h.picked] = CARREFOUR;
    const dialog = await openReceipts();
    fireEvent.click(within(dialog).getByRole('button', { name: /Choisir une photo/ }));
    await waitFor(() => expect(within(dialog).getByText(/Noté, à vérifier/)).toBeInTheDocument());
    expect(h.saved).toEqual([]);
    expect(entryAt(0).receipt).toBe('/home/a/Pictures/ticket.png');
    expect(nb(screen.getByTestId('figure-spent').textContent)).toBe('35,10 €');
  });
});
