/**
 * The lines that come back (doc 177 §2): the rent every 5th, the cleaner
 * every Tuesday. ⛔ No engine of our own: the dates are walked by the
 * Agenda's RRULE module (doc 168 §5), which imports nothing and so bundles
 * into a cartridge as it is.
 *
 * 🚨 An occurrence is a PLAN, never a payment: it only becomes a paid line
 *    when the person (or the orb, into « À vérifier ») says it was paid.
 */
import { expandRRule, formatRRule, parseRRule, type RRule } from '../../../../packages/widget-docs/src/agenda/agendaRRule';
import { localDay } from './dates';
import type { Day, Recurring } from './types';

export type Repeat = 'weekly' | 'monthly' | 'yearly';
export const REPEATS: readonly Repeat[] = ['weekly', 'monthly', 'yearly'];

function dayParts(day: Day): [number, number, number] {
  return day.split('-').map(Number) as [number, number, number];
}

/**
 * The rule for a line that repeats from `start`. A monthly line due on the
 * 29th, 30th or 31st falls on the last day of a shorter month: rent is due
 * in February too (a bare BYMONTHDAY=30 would skip it, RFC 5545).
 */
export function ruleFor(repeat: Repeat, start: Day): string {
  const [, m, d] = dayParts(start);
  const weekday = new Date(dayParts(start)[0], m - 1, d).getDay();
  let rule: RRule;
  if (repeat === 'weekly') rule = { freq: 'WEEKLY', interval: 1, byDay: [{ weekday }], wkst: 1 };
  else if (repeat === 'yearly') rule = { freq: 'YEARLY', interval: 1, byMonth: [m], byMonthDay: [d], wkst: 1 };
  else if (d === 31) rule = { freq: 'MONTHLY', interval: 1, byMonthDay: [-1], wkst: 1 };
  else if (d >= 29) rule = { freq: 'MONTHLY', interval: 1, byMonthDay: Array.from({ length: d - 27 }, (_, i) => 28 + i), bySetPos: [-1], wkst: 1 };
  else rule = { freq: 'MONTHLY', interval: 1, byMonthDay: [d], wkst: 1 };
  return formatRRule(rule);
}

/** weekly / monthly / yearly, read back from a rule; null for one this cartridge did not write. */
export function repeatOf(rrule: string): Repeat | null {
  const rule = parseRRule(rrule);
  if (!rule || rule.interval !== 1) return null;
  return rule.freq === 'WEEKLY' ? 'weekly' : rule.freq === 'MONTHLY' ? 'monthly' : rule.freq === 'YEARLY' ? 'yearly' : null;
}

/** At most this many occurrences in one window: a weekly line in a month is 5. */
const MAX_IN_WINDOW = 62;

/** The due days of a recurring line inside [first, last], ascending. An unreadable rule has none (never guessed). */
export function occurrencesBetween(rec: Recurring, first: Day, last: Day): Day[] {
  const rule = parseRRule(rec.rrule);
  if (!rule) return [];
  const [sy, sm, sd] = dayParts(rec.start);
  const [fy, fm, fd] = dayParts(first);
  const [ly, lm, ld] = dayParts(last);
  const times = expandRRule(
    new Date(sy, sm - 1, sd).getTime(),
    rule,
    new Date(fy, fm - 1, fd).getTime(),
    new Date(ly, lm - 1, ld, 23, 59, 59).getTime(),
    { max: MAX_IN_WINDOW, dayKeyOf: (at) => localDay(new Date(at)) },
  );
  return times.map((at) => localDay(new Date(at)));
}
