/**
 * What a confirmed line looks like once it is a chronicle (doc 177 §4).
 *
 * The text names the day, the pocket, the category and the amount inside
 * itself, so a later question asked in the vault (« combien pour le chien en
 * mars ? ») finds it without knowing it came from MnemoBudget. The checksum is
 * the text's own fingerprint: a line sent twice is kept once, a corrected one
 * is a new chronicle (the old one stays: memory never deletes on its own).
 *
 * Only a PAID line a person has looked at enters: a plan is not money spent,
 * and a line waiting for review may be a word misheard.
 */
import { formatMoney } from './money';
import { sha256Hex } from './sha256';
import type { BudgetSettings, Entry } from './types';

export interface MemoryLine {
  content: string;
  sourceRef: string;
  checksum: string;
}

/** Only a paid line a person confirmed: a plan is not money spent, a line to review may be a word misheard. */
export function belongsInMemory(entry: Entry): boolean {
  return entry.status === 'paid' && !entry.review;
}

/** The chronicle of one line: its text, a source the vault can name, and the text's fingerprint. */
export function memoryLine(entry: Entry, settings: BudgetSettings): MemoryLine {
  const pocket = settings.pockets.find((p) => p.id === entry.pocketId);
  const category = pocket?.categories.find((c) => c.id === entry.categoryId);
  const where = [pocket?.name, category?.name].filter(Boolean).join(' › ') || entry.pocketId;
  // One writing for every chronicle, whatever the screen's language: the vault is searched by words.
  const amount = formatMoney(entry.amountCents, entry.currency, 'fr').replace(/[  ]/g, ' ');
  const content = `MnemoBudget · ${entry.day} · ${where} · ${amount} (${entry.currency})${entry.label ? ` · ${entry.label}` : ''}`;
  return { content, sourceRef: `mnemo-budget/entry/${entry.id}`, checksum: sha256Hex(content) };
}
