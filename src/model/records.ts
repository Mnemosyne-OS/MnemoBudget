/**
 * Reading records from disk, and making new ones. Pure.
 *
 * A file that does not hold a record is refused WHOLE (null) and named to the
 * person by the store, never patched with invented values: an entry without
 * an amount is not an entry of 0.
 */
import { isDay } from './dates';
import { MAX_CENTS } from './money';
import type { BudgetSettings, Category, Entry, Origin, Pocket, Rate, Recurring } from './types';

const ORIGINS: readonly Origin[] = ['typed', 'agent', 'recurring', 'scan'];
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** A file-safe id: a prefix, the time in base 36, and random letters. */
export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const text = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_CENTS ? v : null);
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

function base(r: Raw) {
  const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
  const amountCents = cents(r.amountCents);
  const currency = typeof r.currency === 'string' && CURRENCY.test(r.currency) ? r.currency : null;
  const pocketId = typeof r.pocketId === 'string' && ID.test(r.pocketId) ? r.pocketId : null;
  const origin = ORIGINS.includes(r.origin as Origin) ? (r.origin as Origin) : null;
  const createdAt = stamp(r.createdAt);
  const updatedAt = stamp(r.updatedAt) ?? createdAt;
  if (!id || !amountCents || !currency || !pocketId || !origin || !createdAt || !updatedAt) return null;
  const out: { id: string; amountCents: number; currency: string; pocketId: string; origin: Origin; createdAt: string; updatedAt: string; categoryId?: string; label?: string; review?: true } = {
    id, amountCents, currency, pocketId, origin, createdAt, updatedAt,
  };
  if (typeof r.categoryId === 'string' && ID.test(r.categoryId)) out.categoryId = r.categoryId;
  const label = text(r.label);
  if (label) out.label = label;
  if (r.review === true) out.review = true;
  return out;
}

/** A paid or planned line read from disk, or null when the file is not one. */
export function normalizeEntry(raw: unknown): Entry | null {
  const r = obj(raw);
  if (!r) return null;
  const b = base(r);
  const status = r.status === 'paid' || r.status === 'planned' ? r.status : null;
  if (!b || !status || !isDay(r.day)) return null;
  const entry: Entry = { ...b, status, day: r.day };
  if (status === 'planned' && r.wholeMonth === true) entry.wholeMonth = true;
  if (typeof r.recurringId === 'string' && ID.test(r.recurringId) && isDay(r.occurrence)) {
    entry.recurringId = r.recurringId;
    entry.occurrence = r.occurrence;
  }
  const receipt = text(r.receipt, 500);
  if (receipt) entry.receipt = receipt;
  return entry;
}

/** A recurring line read from disk, or null when the file is not one. */
export function normalizeRecurring(raw: unknown): Recurring | null {
  const r = obj(raw);
  if (!r) return null;
  const b = base(r);
  const rrule = text(r.rrule, 300);
  if (!b || !rrule || !isDay(r.start)) return null;
  return { ...b, rrule, start: r.start };
}

function normalizeCategory(raw: unknown): Category | null {
  const r = obj(raw);
  const id = r && typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
  const name = r ? text(r.name, 80) : undefined;
  if (!r || !id || !name) return null;
  const cat: Category = { id, name };
  const cap = cents(r.capCents);
  if (cap) cat.capCents = cap;
  return cat;
}

function normalizePocket(raw: unknown): Pocket | null {
  const r = obj(raw);
  const id = r && typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
  const name = r ? text(r.name, 80) : undefined;
  if (!r || !id || !name) return null;
  const pocket: Pocket = {
    id,
    name,
    categories: Array.isArray(r.categories) ? r.categories.map(normalizeCategory).filter((c): c is Category => c !== null) : [],
  };
  const icon = text(r.icon, 8);
  if (icon) pocket.icon = icon;
  return pocket;
}

/** Null when the file is not settings: the store then leaves it intact, never overwritten by defaults. */
export function normalizeSettings(raw: unknown): BudgetSettings | null {
  const r = obj(raw);
  if (!r || r.version !== 1 || typeof r.baseCurrency !== 'string' || !CURRENCY.test(r.baseCurrency) || !Array.isArray(r.pockets)) return null;
  const rates: Record<string, Rate> = {};
  const rawRates = obj(r.rates) ?? {};
  for (const [code, value] of Object.entries(rawRates)) {
    const rate = obj(value);
    if (CURRENCY.test(code) && rate && typeof rate.value === 'number' && Number.isFinite(rate.value) && rate.value > 0 && isDay(rate.day)) {
      rates[code] = { value: rate.value, day: rate.day, ...(rate.typedAsBase === true ? { typedAsBase: true as const } : {}) };
    }
  }
  const settings: BudgetSettings = {
    version: 1,
    baseCurrency: r.baseCurrency,
    pockets: r.pockets.map(normalizePocket).filter((p): p is Pocket => p !== null),
    rates,
    memory: r.memory === true,
  };
  // The currencies the person uses: codes only, the base never among them, each once.
  if (Array.isArray(r.currencies)) {
    const codes = [...new Set(r.currencies.filter((c): c is string => typeof c === 'string' && CURRENCY.test(c) && c !== settings.baseCurrency))];
    if (codes.length) settings.currencies = codes;
  }
  return settings;
}

/** The starter pockets, named in the person's language (`names` comes translated). */
export function starterSettings(names: {
  home: string; family: string; work: string;
  rent: string; groceries: string; dog: string; cleaner: string;
  children: string; school: string; health: string;
  workRent: string; suppliers: string; wages: string;
}, baseCurrency = 'EUR'): BudgetSettings {
  const cat = (name: string): Category => ({ id: newId('c'), name });
  return {
    version: 1,
    baseCurrency,
    pockets: [
      { id: newId('p'), name: names.home, icon: '🏠', categories: [cat(names.rent), cat(names.groceries), cat(names.dog), cat(names.cleaner)] },
      { id: newId('p'), name: names.family, icon: '👨‍👧', categories: [cat(names.children), cat(names.school), cat(names.health)] },
      { id: newId('p'), name: names.work, icon: '💼', categories: [cat(names.workRent), cat(names.suppliers), cat(names.wages)] },
    ],
    rates: {},
    memory: true,
  };
}
