/**
 * The whole budget as React state: settings, lines, recurring lines.
 *
 * The folder is the truth. A list on screen changes only after the host
 * REPORTED the write, so a refused save never shows a line that is not on
 * disk (rule 11: loading, error and data are three separate states).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ENTRIES_DIR, RECURRING_DIR, joinPath, loadRecords, readSettings, saveRecord, writeSettings } from './folderStore';
import { appFolder, deleteFile, hostIO, pickFolder, readMirroredFolder, readRememberedFolder, rememberFolder, rememberLine } from './host';
import { belongsInMemory, memoryLine } from '../model/memory';
import { normalizeEntry, normalizeRecurring, starterSettings } from '../model/records';
import type { BudgetSettings, Entry, Recurring } from '../model/types';
import { translate } from '../i18n';

export type BudgetStatus =
  | { kind: 'booting' }
  | { kind: 'noFolder'; bridgeError?: string }
  | { kind: 'loading'; folder: string }
  | { kind: 'error'; folder: string; message: string; settingsUnreadable?: true }
  | { kind: 'ready'; folder: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function upsertIn<T extends { id: string }>(list: T[], record: T): T[] {
  const i = list.findIndex((r) => r.id === record.id);
  if (i === -1) return [...list, record];
  const next = list.slice();
  next[i] = record;
  return next;
}

/** The starter pockets, named in the language on screen, counted in the currency chosen on the welcome screen. */
function starter(baseCurrency: string): BudgetSettings {
  const k = (key: string) => translate(`starter.${key}`);
  return starterSettings({
    home: k('home'), family: k('family'), work: k('work'),
    rent: k('rent'), groceries: k('groceries'), dog: k('dog'), cleaner: k('cleaner'),
    children: k('children'), school: k('school'), health: k('health'),
    workRent: k('workRent'), suppliers: k('suppliers'), wages: k('wages'),
  }, baseCurrency);
}

/**
 * The budget of the folder the person chose. It refuses to show a line the
 * host did not report written, and never replaces a settings.json it cannot read.
 */
export function useBudget() {
  const [status, setStatus] = useState<BudgetStatus>({ kind: 'booting' });
  const [settings, setSettings] = useState<BudgetSettings | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const folderRef = useRef<string | null>(null);
  // The main currency a new budget starts with: chosen on the welcome screen, EUR until then.
  const [starterBase, setStarterBase] = useState('EUR');
  const starterBaseRef = useRef(starterBase);
  starterBaseRef.current = starterBase;
  // The latest values, for handlers that outlive a render (the agent actions).
  const latest = useRef({ settings, entries, recurring });
  latest.current = { settings, entries, recurring };
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const open = useCallback(async (folder: string) => {
    folderRef.current = folder;
    setStatus({ kind: 'loading', folder });
    try {
      const [e, r, s] = await Promise.all([
        loadRecords(hostIO, folder, ENTRIES_DIR, normalizeEntry),
        loadRecords(hostIO, folder, RECURRING_DIR, normalizeRecurring),
        readSettings(hostIO, folder),
      ]);
      if (!aliveRef.current || folderRef.current !== folder) return;
      if (s.state === 'unreadable') {
        setStatus({ kind: 'error', folder, message: translate('error.settings'), settingsUnreadable: true });
        return;
      }
      let current = s.state === 'ok' ? s.settings : null;
      if (!current) {
        // A new folder: the starter pockets are written once, so the next opening reads them back.
        current = starter(starterBaseRef.current);
        await writeSettings(hostIO, folder, current);
      }
      if (!aliveRef.current || folderRef.current !== folder) return;
      setSettings(current);
      setEntries(e.records);
      setRecurring(r.records);
      setUnreadable([...e.unreadable, ...r.unreadable]);
      setStatus({ kind: 'ready', folder });
    } catch (err) {
      console.warn('[mnemo-budget] could not open the budget:', err);
      if (!aliveRef.current || folderRef.current !== folder) return;
      setStatus({ kind: 'error', folder, message: message(err) });
    }
  }, []);

  // Boot: the folder remembered here, else the one mirrored by the host.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readRememberedFolder();
      if (local) {
        if (!cancelled) void open(local);
        return;
      }
      try {
        const mirrored = await readMirroredFolder();
        if (cancelled) return;
        if (mirrored) void open(mirrored);
        else setStatus({ kind: 'noFolder' });
      } catch (err) {
        console.warn('[mnemo-budget] host mirror unreadable:', err);
        if (!cancelled) setStatus({ kind: 'noFolder', bridgeError: message(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chooseFolder = useCallback(async () => {
    try {
      const folder = await pickFolder();
      if (!folder) return; // cancelled: nothing changes, nothing to say
      try {
        await rememberFolder(folder);
      } catch (err) {
        // The folder still opens; only the reopening after an origin change is at risk.
        console.warn('[mnemo-budget] folder not mirrored on the host:', err);
      }
      await open(folder);
    } catch (err) {
      console.warn('[mnemo-budget] folder picker failed:', err);
      setStatus((prev) => (prev.kind === 'ready' || prev.kind === 'error' || prev.kind === 'loading'
        ? { kind: 'error', folder: prev.folder, message: message(err) }
        : { kind: 'noFolder', bridgeError: message(err) }));
    }
  }, [open]);

  const reload = useCallback(() => {
    if (folderRef.current) void open(folderRef.current);
  }, [open]);

  /**
   * The folder the OS proposes (doc 177 §12), named before anything is made:
   * `undefined` while asking, `null` when the host has none to give (then the
   * picker is the only way, as before).
   */
  const [proposed, setProposed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (status.kind !== 'noFolder' || proposed !== undefined) return undefined;
    let cancelled = false;
    appFolder(false)
      .then((folder) => { if (!cancelled) setProposed(folder); })
      .catch((err) => {
        console.warn('[mnemo-budget] no folder proposed by the host, the picker stays:', err);
        if (!cancelled) setProposed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status.kind, proposed]);

  /** « OK »: the proposed folder is created, remembered, opened. */
  const acceptProposed = useCallback(async () => {
    try {
      const folder = await appFolder(true);
      try {
        await rememberFolder(folder);
      } catch (err) {
        console.warn('[mnemo-budget] folder not mirrored on the host:', err);
      }
      await open(folder);
    } catch (err) {
      console.warn('[mnemo-budget] the proposed folder could not be made:', err);
      setStatus({ kind: 'noFolder', bridgeError: message(err) });
    }
  }, [open]);

  /** Sends a confirmed paid line to the vault when the person turned memory on. Never blocks the save. */
  const remember = useCallback((entry: Entry, s: BudgetSettings) => {
    if (!s.memory || !belongsInMemory(entry)) return;
    const line = memoryLine(entry, s);
    rememberLine(line.content, line.sourceRef, line.checksum)
      .then(() => setMemoryError(null))
      .catch((err) => {
        console.warn('[mnemo-budget] line not sent to memory:', err);
        setMemoryError(message(err));
      });
  }, []);

  const saveEntry = useCallback(async (entry: Entry): Promise<boolean> => {
    const folder = folderRef.current;
    if (!folder) return false;
    try {
      await saveRecord(hostIO, folder, ENTRIES_DIR, entry);
      latest.current = { ...latest.current, entries: upsertIn(latest.current.entries, entry) };
      setEntries((list) => upsertIn(list, entry));
      setSaveError(null);
      if (latest.current.settings) remember(entry, latest.current.settings);
      return true;
    } catch (err) {
      console.warn('[mnemo-budget] line not saved:', err);
      setSaveError(message(err));
      return false;
    }
  }, [remember]);

  const saveRecurring = useCallback(async (rec: Recurring): Promise<boolean> => {
    const folder = folderRef.current;
    if (!folder) return false;
    try {
      await saveRecord(hostIO, folder, RECURRING_DIR, rec);
      latest.current = { ...latest.current, recurring: upsertIn(latest.current.recurring, rec) };
      setRecurring((list) => upsertIn(list, rec));
      setSaveError(null);
      return true;
    } catch (err) {
      console.warn('[mnemo-budget] recurring line not saved:', err);
      setSaveError(message(err));
      return false;
    }
  }, []);

  const saveSettings = useCallback(async (next: BudgetSettings): Promise<boolean> => {
    const folder = folderRef.current;
    if (!folder) return false;
    try {
      await writeSettings(hostIO, folder, next);
      // Read before the next render by a save that follows (a new category, then its line).
      latest.current = { ...latest.current, settings: next };
      setSettings(next);
      setSaveError(null);
      return true;
    } catch (err) {
      console.warn('[mnemo-budget] settings not saved:', err);
      setSaveError(message(err));
      return false;
    }
  }, []);

  /** The person's own click only: the file leaves the folder. */
  const removeRecord = useCallback(async (dir: 'entries' | 'recurring', id: string): Promise<boolean> => {
    const folder = folderRef.current;
    if (!folder) return false;
    try {
      await deleteFile(joinPath(folder, dir === 'entries' ? ENTRIES_DIR : RECURRING_DIR, `${id}.json`));
      // Read before the next render by an agent call that follows.
      if (dir === 'entries') {
        latest.current = { ...latest.current, entries: latest.current.entries.filter((e) => e.id !== id) };
        setEntries((list) => list.filter((e) => e.id !== id));
      } else {
        latest.current = { ...latest.current, recurring: latest.current.recurring.filter((r) => r.id !== id) };
        setRecurring((list) => list.filter((r) => r.id !== id));
      }
      setSaveError(null);
      return true;
    } catch (err) {
      console.warn('[mnemo-budget] line not deleted:', err);
      setSaveError(message(err));
      return false;
    }
  }, []);

  /** A human looked at it: off the review list, and into memory when it is a paid line. */
  const confirm = useCallback(async (item: Entry | Recurring): Promise<boolean> => {
    const now = new Date().toISOString();
    const next = { ...item, updatedAt: now };
    delete next.review;
    return 'status' in next ? saveEntry(next as Entry) : saveRecurring(next as Recurring);
  }, [saveEntry, saveRecurring]);

  return {
    status, settings, entries, recurring, unreadable, saveError, memoryError, latest,
    proposed, acceptProposed, chooseFolder, reload, saveEntry, saveRecurring, saveSettings, removeRecord, confirm,
    starterBase, setStarterBase,
    clearSaveError: () => setSaveError(null),
  };
}

export type Budget = ReturnType<typeof useBudget>;
