import { describe, expect, it } from 'vitest';
import { joinPath, loadRecords, readSettings, saveRecord, StoreError } from './folderStore';
import { normalizeEntry } from '../model/records';
import { memoryIO } from '../test/memoryIO';

const T = '2026-10-01T10:00:00.000Z';
const entry = { id: 'e1', status: 'paid', amountCents: 8000, currency: 'EUR', day: '2026-10-03', pocketId: 'home', origin: 'typed', createdAt: T, updatedAt: T };

describe('folderStore', () => {
  it('a Windows root keeps its separator', () => {
    expect(joinPath('C:\\Budget\\', 'entries', 'e1.json')).toBe('C:\\Budget\\entries\\e1.json');
    expect(joinPath('/home/a/Budget', 'entries')).toBe('/home/a/Budget/entries');
  });

  it('writes one file per line and reads it back', async () => {
    const io = memoryIO();
    await saveRecord(io, '/b', 'entries', entry);
    const { records, unreadable } = await loadRecords(io, '/b', 'entries', normalizeEntry);
    expect(records).toEqual([entry]);
    expect(unreadable).toEqual([]);
  });

  it('🚨 a cut file and a duplicate id are NAMED, never counted as 0 or merged', async () => {
    const io = memoryIO({
      '/b/entries/e1.json': JSON.stringify(entry),
      '/b/entries/e1-copy.json': JSON.stringify(entry),
      '/b/entries/cut.json': '{"id":"e2","amou',
      '/b/entries/zero.json': JSON.stringify({ ...entry, id: 'e3', amountCents: 0 }),
    });
    const { records, unreadable } = await loadRecords(io, '/b', 'entries', normalizeEntry);
    expect(records).toHaveLength(1);
    expect(unreadable).toHaveLength(3);
  });

  it('a listing failure is an error, never an empty budget', async () => {
    const io = { ...memoryIO(), readDir: async () => ({ success: false, error: 'EACCES' }) };
    await expect(loadRecords(io, '/b', 'entries', normalizeEntry)).rejects.toBeInstanceOf(StoreError);
  });

  it('an id that could leave the folder is refused', async () => {
    await expect(saveRecord(memoryIO(), '/b', 'entries', { id: '../x' })).rejects.toThrow('BAD_ID');
  });

  it('settings: absent, ok, and unreadable left intact', async () => {
    expect(await readSettings(memoryIO(), '/b')).toEqual({ state: 'absent' });
    const good = { version: 1, baseCurrency: 'EUR', pockets: [], rates: {}, memory: false };
    expect(await readSettings(memoryIO({ '/b/settings.json': JSON.stringify(good) }), '/b')).toEqual({ state: 'ok', settings: good });
    const io = memoryIO({ '/b/settings.json': 'not json' });
    expect(await readSettings(io, '/b')).toEqual({ state: 'unreadable' });
    expect(io.files.get('/b/settings.json')).toBe('not json');
  });
});
