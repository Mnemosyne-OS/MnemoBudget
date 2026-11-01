/**
 * The budget on disk: one JSON file per line, in a folder the person chose
 * (doc 177 §4, the CRM lesson of doc 124 §4). The folder is the source of
 * truth; nothing lives only in the iframe's localStorage.
 *
 * Layout:
 *   <root>/entries/<id>.json     paid and planned lines
 *   <root>/recurring/<id>.json   lines that come back
 *   <root>/settings.json         pockets, categories, caps, rates
 *
 * ⚠️ The host's writeFile is a plain overwrite, not an atomic rename. A file
 * cut by a crash is named on the next load (`unreadable`), never dropped in
 * silence and never counted as 0.
 */
import { normalizeSettings } from '../model/records';
import type { BudgetSettings } from '../model/types';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** The four host calls this store needs. Injected so tests run without a host. */
export interface FolderIO {
  mkdir(dirPath: string): Promise<{ success: boolean; error?: string }>;
  readDir(dirPath: string): Promise<{ success: boolean; files?: DirEntry[]; error?: string }>;
  readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
}

export const ENTRIES_DIR = 'entries';
export const RECURRING_DIR = 'recurring';
export const SETTINGS_FILE = 'settings.json';

/** Join with the separator the root already uses, so a Windows path stays one. */
export function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  return [trimmed, ...parts].join(sep);
}

/** Only a plain id may become a file name: no separators, no dots, no traversal. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

export class StoreError extends Error {
  constructor(
    public readonly code: 'MKDIR_FAILED' | 'LIST_FAILED' | 'WRITE_FAILED' | 'BAD_ID',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'StoreError';
  }
}

export interface LoadResult<T> {
  records: T[];
  /** File names that exist but could not be read as a record. Shown to the person. */
  unreadable: string[];
}

/** Read every `<dir>/*.json` through `normalize`. A listing failure is an ERROR, never an empty budget. */
export async function loadRecords<T extends { id: string }>(
  io: FolderIO,
  root: string,
  dir: string,
  normalize: (raw: unknown) => T | null,
): Promise<LoadResult<T>> {
  const path = joinPath(root, dir);
  const made = await io.mkdir(path);
  if (!made.success) throw new StoreError('MKDIR_FAILED', made.error);
  const listed = await io.readDir(path);
  if (!listed.success) throw new StoreError('LIST_FAILED', listed.error);

  const files = (listed.files ?? []).filter((f) => !f.isDirectory && f.name.toLowerCase().endsWith('.json'));
  const results = await Promise.all(files.map(async (file) => {
    try {
      const read = await io.readFile(file.path);
      if (!read.success || typeof read.content !== 'string') return { file, record: null };
      return { file, record: normalize(JSON.parse(read.content)) };
    } catch (err) {
      console.warn(`[mnemo-budget] could not read ${dir}/${file.name}:`, err);
      return { file, record: null };
    }
  }));

  const records: T[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  for (const { file, record } of results) {
    // Two files claiming one id would make an edit land in one and vanish from the other.
    if (!record || seen.has(record.id)) {
      unreadable.push(`${dir}/${file.name}`);
      continue;
    }
    seen.add(record.id);
    records.push(record);
  }
  unreadable.sort();
  return { records, unreadable };
}

/** Writes one record as `<dir>/<id>.json`; an id that could leave the folder is refused. */
export async function saveRecord(io: FolderIO, root: string, dir: string, record: { id: string }): Promise<void> {
  if (!isSafeId(record.id)) throw new StoreError('BAD_ID', record.id);
  const path = joinPath(root, dir);
  const made = await io.mkdir(path);
  if (!made.success) throw new StoreError('MKDIR_FAILED', made.error);
  const written = await io.writeFile(joinPath(path, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  if (!written.success) throw new StoreError('WRITE_FAILED', written.error);
}

/** Settings have three states, never two. */
export type SettingsRead =
  | { state: 'absent' }
  | { state: 'ok'; settings: BudgetSettings }
  /** The file exists and is not settings. It is LEFT INTACT: never overwritten by defaults. */
  | { state: 'unreadable' };

/** settings.json in one of three states: absent, read, or present and not settings (then left intact). */
export async function readSettings(io: FolderIO, root: string): Promise<SettingsRead> {
  const listed = await io.readDir(root.replace(/[\\/]+$/, ''));
  if (!listed.success) throw new StoreError('LIST_FAILED', listed.error);
  const exists = (listed.files ?? []).some((f) => !f.isDirectory && f.name === SETTINGS_FILE);
  if (!exists) return { state: 'absent' };
  const read = await io.readFile(joinPath(root, SETTINGS_FILE));
  if (!read.success || typeof read.content !== 'string') return { state: 'unreadable' };
  try {
    const settings = normalizeSettings(JSON.parse(read.content));
    return settings ? { state: 'ok', settings } : { state: 'unreadable' };
  } catch (err) {
    console.warn('[mnemo-budget] settings.json is not valid JSON:', err);
    return { state: 'unreadable' };
  }
}

/** Writes settings.json whole. */
export async function writeSettings(io: FolderIO, root: string, settings: BudgetSettings): Promise<void> {
  const written = await io.writeFile(joinPath(root, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  if (!written.success) throw new StoreError('WRITE_FAILED', written.error);
}
