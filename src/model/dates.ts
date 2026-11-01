/**
 * Days and months, read from the words a person says (FR / EN / ES first).
 * Pure: « today » is always passed in.
 *
 * 🚨 The orb's planner is told to COPY the person's words for a day, never to
 *    compute a date: a remembered plan (doc 149 §17, orbRecipes) replays the
 *    same arguments next week, and « hier » computed once would stay the
 *    23rd forever. The day is computed here, at each call.
 *
 * `past`: a payment (« lundi » = the last Monday, today included).
 * `future`: a plan (« lundi » = the next Monday, today included).
 */
import type { Day, Month } from './types';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The local day of an instant. */
export function localDay(at: Date = new Date()): Day {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

export function monthOf(day: Day): Month {
  return day.slice(0, 7);
}

export function isDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  return at.getFullYear() === y && at.getMonth() === m - 1 && at.getDate() === d;
}

export function isMonth(s: unknown): s is Month {
  return typeof s === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(s);
}

function toDate(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  const at = toDate(day);
  at.setDate(at.getDate() + n);
  return localDay(at);
}

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const at = new Date(y, m - 1 + n, 1);
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}`;
}

/** The first and last day of a month. */
export function monthRange(month: Month): { first: Day; last: Day } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { first: `${month}-01`, last: `${month}-${pad2(new Date(y, m, 0).getDate())}` };
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, ' ')
    // A hyphen joins words (« avant-hier », « ce mois-ci ») or digits (« 24-10-2026 »): only the second stays.
    .replace(/(?<=[a-z])-|-(?=[a-z])/g, ' ')
    .replace(/[^a-z0-9/\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  jan: 1, feb: 2, fev: 2, apr: 4, avr: 4, jun: 6, jul: 7, juil: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** 0 = Sunday, as Date counts. */
const WEEKDAYS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

const TODAY = /\b(?:aujourd hui|auj|today|hoy|ce jour)\b/;
const YESTERDAY = /\b(?:hier|yesterday|ayer)\b/;
const BEFORE_YESTERDAY = /\b(?:avant hier|day before yesterday|anteayer|antes de ayer)\b/;
const TOMORROW = /\b(?:demain|tomorrow|manana)\b/;
const AFTER_TOMORROW = /\b(?:apres demain|day after tomorrow|pasado manana)\b/;
const THIS_MONTH = /\b(?:ce mois(?: ci)?|dans le mois|this month|este mes|en el mes)\b/;
const NEXT_MONTH = /\b(?:le mois prochain|mois prochain|next month|el mes que viene|el proximo mes|mes proximo)\b/;
const LAST_MONTH = /\b(?:le mois dernier|mois dernier|last month|el mes pasado)\b/;
const IN_DAYS = /\b(?:dans|in|en|dentro de)\s+(\d{1,3})\s+(?:jours?|days?|dias?)\b/;
const LAST_WEEKDAY = /\b(?:dernier|derniere|passe|last|pasado|anterior)\b/;
const NEXT_WEEKDAY = /\b(?:prochain|prochaine|next|proximo|que viene)\b/;
const DAYS_AGO =/\b(?:il y a\s+(\d{1,3})\s+jours?|(\d{1,3})\s+days?\s+ago|hace\s+(\d{1,3})\s+dias?)\b/;

export interface SpokenDay {
  day: Day;
  /** A month was named and no day: due « in December ». */
  wholeMonth?: true;
}

function sameOrBefore(a: Day, b: Day) {
  return a <= b;
}

/** A day of a month in the year that fits the direction: last occurrence for `past`, next for `future`. */
function yearFor(month: number, dayOfMonth: number, today: Day, mode: 'past' | 'future'): Day | null {
  const y = Number(today.slice(0, 4));
  for (const year of mode === 'past' ? [y, y - 1] : [y, y + 1]) {
    const day = `${year}-${pad2(month)}-${pad2(dayOfMonth)}`;
    if (!isDay(day)) continue;
    if (mode === 'past' ? sameOrBefore(day, today) : sameOrBefore(today, day)) return day;
  }
  return null;
}

/**
 * The day said, or null when the words name none. An empty phrase is null:
 * the caller decides the default (today for a payment).
 */
export function parseSpokenDay(raw: unknown, today: Day, mode: 'past' | 'future'): SpokenDay | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isDay(trimmed)) return { day: trimmed };
  const s = fold(trimmed);

  // Two-word phrases before the one-word ones they contain (« avant-hier » holds « hier »).
  if (BEFORE_YESTERDAY.test(s)) return { day: addDays(today, -2) };
  if (AFTER_TOMORROW.test(s)) return { day: addDays(today, 2) };
  if (TODAY.test(s)) return { day: today };
  if (YESTERDAY.test(s)) return { day: addDays(today, -1) };
  if (TOMORROW.test(s)) return { day: addDays(today, 1) };
  const inDays = IN_DAYS.exec(s);
  if (inDays) return { day: addDays(today, Number(inDays[1])) };
  const ago = DAYS_AGO.exec(s);
  if (ago) return { day: addDays(today, -Number(ago[1] ?? ago[2] ?? ago[3])) };
  if (NEXT_MONTH.test(s)) return { day: `${addMonths(monthOf(today), 1)}-01`, wholeMonth: true };
  if (LAST_MONTH.test(s)) return { day: `${addMonths(monthOf(today), -1)}-01`, wholeMonth: true };

  // 24/10/2026, 24/10, 24-10-2026
  const slash = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(s);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    if (slash[3]) {
      const y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
      const day = `${y}-${pad2(m)}-${pad2(d)}`;
      return isDay(day) ? { day } : null;
    }
    const day = yearFor(m, d, today, mode);
    return day ? { day } : null;
  }

  const words = s.split(' ');
  const monthWord = words.find((w) => MONTHS[w] !== undefined);
  const number = words.map((w) => /^(\d{1,2})(?:er|st|nd|rd|th|e)?$/.exec(w)).find(Boolean);
  if (monthWord) {
    const month = MONTHS[monthWord]!;
    if (number) {
      const day = yearFor(month, Number(number[1]), today, mode);
      return day ? { day } : null;
    }
    const first = yearFor(month, 1, `${monthOf(today)}-01`, mode);
    return first ? { day: first, wholeMonth: true } : null;
  }

  const weekday = words.find((w) => WEEKDAYS[w] !== undefined);
  if (weekday) {
    const target = WEEKDAYS[weekday]!;
    const now = toDate(today).getDay();
    const back = (now - target + 7) % 7;
    const ahead = (target - now + 7) % 7;
    // « lundi dernier » / « lundi prochain » say the direction themselves, and never mean today.
    if (LAST_WEEKDAY.test(s)) return { day: addDays(today, -(back || 7)) };
    if (NEXT_WEEKDAY.test(s)) return { day: addDays(today, ahead || 7) };
    return { day: addDays(today, mode === 'past' ? -back : ahead) };
  }

  if (THIS_MONTH.test(s)) return { day: `${monthOf(today)}-01`, wholeMonth: true };

  // « le 5 », « the 5th », « el 5 »: a day of this month, else the month that fits the direction.
  if (number && /\b(?:le|the|el|on the|au)\s+\d/.test(s)) {
    const d = Number(number[1]);
    const thisMonth = `${monthOf(today)}-${pad2(d)}`;
    if (isDay(thisMonth) && (mode === 'past' ? sameOrBefore(thisMonth, today) : sameOrBefore(today, thisMonth))) return { day: thisMonth };
    const other = `${addMonths(monthOf(today), mode === 'past' ? -1 : 1)}-${pad2(d)}`;
    return isDay(other) ? { day: other } : null;
  }
  return null;
}

/** A month said for a summary: « octobre », « 2026-10 », « le mois dernier ». Empty = null (the caller takes this month). */
export function parseSpokenMonth(raw: unknown, today: Day): Month | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = raw.trim();
  if (isMonth(t)) return t;
  if (isDay(t)) return monthOf(t);
  const s = fold(t);
  if (THIS_MONTH.test(s) || /\b(?:ce mois|mois en cours|current month)\b/.test(s)) return monthOf(today);
  if (LAST_MONTH.test(s)) return addMonths(monthOf(today), -1);
  if (NEXT_MONTH.test(s)) return addMonths(monthOf(today), 1);
  const words = s.split(' ');
  const monthWord = words.find((w) => MONTHS[w] !== undefined);
  if (!monthWord) return null;
  const year = words.find((w) => /^\d{4}$/.test(w));
  const m = MONTHS[monthWord]!;
  if (year) return `${year}-${pad2(m)}`;
  // A month named alone is the latest one that is not in the future: « en mars » said in October is this March.
  const y = Number(today.slice(0, 4));
  const candidate = `${y}-${pad2(m)}`;
  return candidate <= monthOf(today) ? candidate : `${y - 1}-${pad2(m)}`;
}
