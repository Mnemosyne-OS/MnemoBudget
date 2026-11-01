/**
 * Money as integer cents, read from what a person types or says, and written
 * back in their language. Pure.
 *
 * 🚨 No exchange rate is ever invented (doc 177 §3 rule 4): `convert` answers
 *    null for a currency the person gave no rate for, and the caller says so.
 */
import type { Currency, Rate } from './types';

/** The largest amount one line may carry: 10 million in any currency. A typo of ten zeros is refused, not added. */
export const MAX_CENTS = 1_000_000_000;

/**
 * « 80 », « 80,50 », « 80.5 », « 1 200 », « 1.200,50 », « 1,200.50 » → cents.
 * Null for anything else, a negative, zero or more than MAX_CENTS.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[\s  ']/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let units = s;
  let decimals = '';
  // A separator followed by 1 or 2 digits is the decimal mark; 3 digits is a thousands group (« 1.200 »).
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    units = s.slice(0, lastSep);
    decimals = s.slice(lastSep + 1);
    // The decimal mark cannot also be the thousands mark: « 12,345,6 » is no figure.
    if (units.includes(s[lastSep]!)) return null;
  }
  // Thousands groups are groups of three, or the figure is not one (« 12,345,6 »).
  if (!/^\d+$/.test(units) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(units)) return null;
  const digits = units.replace(/[.,]/g, '');
  if (decimals && !/^\d{1,2}$/.test(decimals)) return null;
  const cents = Number(digits) * 100 + Number(decimals.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** A number an agent passed (80, 80.5) → cents. Same bounds as parseAmount. */
export function centsFromNumber(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/**
 * The words and signs a person uses for a currency → its ISO code. The code
 * itself is accepted too. Folded: accents off, lower case, plural « s » off.
 */
const CURRENCY_WORDS: Record<string, Currency> = {
  '€': 'EUR', euro: 'EUR', eur: 'EUR', balle: 'EUR',
  '$': 'USD', dollar: 'USD', usd: 'USD', dolar: 'USD', dolare: 'USD',
  '£': 'GBP', livre: 'GBP', pound: 'GBP', gbp: 'GBP', libra: 'GBP',
  chf: 'CHF', 'franc suisse': 'CHF', 'swiss franc': 'CHF', 'franco suizo': 'CHF',
  mad: 'MAD', dirham: 'MAD', dh: 'MAD', dhs: 'MAD',
  xof: 'XOF', cfa: 'XOF', 'franc cfa': 'XOF',
  dzd: 'DZD', 'dinar algerien': 'DZD',
  tnd: 'TND', 'dinar tunisien': 'TND',
  cad: 'CAD', 'dollar canadien': 'CAD', 'canadian dollar': 'CAD',
  mxn: 'MXN', 'peso mexicain': 'MXN', 'mexican peso': 'MXN', 'peso mexicano': 'MXN',
  brl: 'BRL', real: 'BRL', reai: 'BRL', reale: 'BRL',
  jpy: 'JPY', yen: 'JPY',
  thb: 'THB', baht: 'THB',
};

function foldWord(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** « euros », « €», « dirhams », « MAD » → the code; null when it names no currency known here. */
export function normalizeCurrency(raw: unknown): Currency | null {
  if (typeof raw !== 'string') return null;
  const s = foldWord(raw);
  if (!s) return null;
  if (CURRENCY_WORDS[s]) return CURRENCY_WORDS[s];
  const singular = s.split(' ').map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)).join(' ');
  if (CURRENCY_WORDS[singular]) return CURRENCY_WORDS[singular];
  // An ISO code this table does not name is still a code the person chose (« AED »).
  return /^[a-z]{3}$/.test(s) ? s.toUpperCase() : null;
}

/** A rate typed as the person writes it (« 0,092 », « 10.8 »), or null for anything that is not a positive number. */
export function parseRate(raw: string): number | null {
  const n = Number(raw.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Cents of `currency` in base cents, or null when no rate was given for it. */
export function convert(cents: number, currency: Currency, base: Currency, rates: Record<Currency, Rate>): number | null {
  if (currency === base) return cents;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate.value) || rate.value <= 0) return null;
  return Math.round(cents * rate.value);
}

/** 8000, EUR, fr → « 80,00 € ». An unknown code still prints (« 80,00 AED »). */
export function formatMoney(cents: number, currency: Currency, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(cents / 100);
  } catch (err) {
    console.warn('[mnemo-budget] currency not printable by Intl:', currency, err);
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** The figure alone, for an input: 8050 → « 80,50 » (fr) / « 80.50 » (en). */
export function formatPlain(cents: number, lang: string): string {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);
}
