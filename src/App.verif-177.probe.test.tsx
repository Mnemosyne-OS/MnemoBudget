/**
 * Verification probes for doc 177 (pass of 2026-10-24), the mounted cartridge:
 * is the agent door served before a folder is chosen, and does an opened
 * pocket show the ≤ on what is left when one of its capped categories holds
 * a line without a rate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { memoryIO } from './test/memoryIO';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
const h = vi.hoisted(() => ({
  io: null as unknown as ReturnType<typeof import('./test/memoryIO').memoryIO>,
  handlers: null as Handlers | null,
  folder: '/home/a/Budget' as string | null,
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

import App from './App';
import { setLangMode } from './i18n';

const nb = (s: string | null) => (s ?? '').replace(/[    ]/g, ' ');

beforeEach(() => {
  setLangMode('fr');
  h.io = memoryIO();
  h.handlers = null;
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 10, 0, 0) });
});

describe('the agent door before a folder is chosen', () => {
  it('fixed (doc 177 §11): no folder yet, the actions ARE served and say to choose a folder, writing nothing', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Choisir un dossier/ });
    await act(async () => { await Promise.resolve(); });
    expect(h.handlers).not.toBeNull();
    await expect(Promise.resolve().then(() => h.handlers!.addExpense!({ amount: 20, pocket: 'maison' }))).rejects.toThrow(/^TO_PERSON: Choisissez d'abord un dossier/);
    expect([...h.io.files.keys()]).toEqual([]);
  });
});

describe('an opened pocket and the ≤', () => {
  it('fixed (doc 177 §11): a capped category with a USD line and no rate: the month AND the opened pocket say ≤', async () => {
    const settings = {
      version: 1, baseCurrency: 'EUR', memory: false, rates: {},
      pockets: [{ id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }] }],
    };
    h.io.files.set('/home/a/Budget/settings.json', JSON.stringify(settings));
    h.io.files.set('/home/a/Budget/entries/a.json', JSON.stringify({ id: 'a', status: 'paid', amountCents: 2000, currency: 'EUR', day: '2026-10-03', pocketId: 'home', categoryId: 'dog', origin: 'typed', createdAt: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z' }));
    h.io.files.set('/home/a/Budget/entries/b.json', JSON.stringify({ id: 'b', status: 'paid', amountCents: 5000, currency: 'USD', day: '2026-10-04', pocketId: 'home', categoryId: 'dog', origin: 'typed', createdAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z' }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Choisir un dossier/ }));
    await screen.findByTestId('figure-spent');
    expect(nb(screen.getByTestId('figure-remaining').textContent)).toBe('≤ 100,00 €');
    fireEvent.click(screen.getByRole('button', { name: /Maison/ }));
    const open = nb(screen.getByTestId('figure-remaining').textContent);
    console.log(`[probe-app] opened pocket remaining: « ${open} »`);
    expect(open).toBe('≤ 100,00 €');
  });
});
