/**
 * The shapes of a budget (doc 177 §2). Small on purpose.
 *
 * 🎭 A field nobody said is ABSENT, never 0 or an empty string
 *    (fabricated-values-pattern): a category without a cap is « not set »,
 *    never « 0 left ».
 *
 * Money is always integer minor units (cents): 80,10 + 0,20 must be 80,30,
 * never 80.30000000000001.
 */

/** ISO 4217 code, upper case: EUR, USD, MAD… */
export type Currency = string;

/** `YYYY-MM-DD`, a local day (a payment names a day, not an instant). */
export type Day = string;

/** `YYYY-MM`. */
export type Month = string;

export interface Category {
  id: string;
  name: string;
  /** Monthly cap in the base currency, in cents. Absent = not set. */
  capCents?: number;
}

/** An activity: Home, the restaurant, the pyjama shop, the children. */
export interface Pocket {
  id: string;
  name: string;
  icon?: string;
  categories: Category[];
}

/**
 * Who wrote the line. `agent` covers the orb and every other agent: what was
 * heard is not always what was said, so an agent's line waits for review.
 * `scan`: read off a till receipt's photo (doc 177 §14), which waits too.
 */
export type Origin = 'typed' | 'agent' | 'recurring' | 'scan';

/** One line of the ledger: paid, or planned and not paid yet. */
export interface Entry {
  id: string;
  status: 'paid' | 'planned';
  amountCents: number;
  currency: Currency;
  /** Paid: the day it was paid. Planned: the day it is due (the 1st when `wholeMonth`). */
  day: Day;
  /** Planned « in December », no day said. */
  wholeMonth?: true;
  pocketId: string;
  categoryId?: string;
  label?: string;
  origin: Origin;
  /** Written by an agent and not looked at yet (« À vérifier »). Any human edit removes it. */
  review?: true;
  /** The recurring line it was paid for, and which occurrence (its due day). */
  recurringId?: string;
  occurrence?: Day;
  /** The photo of the receipt this line was read from (an absolute path in the app's folder), when there is one. */
  receipt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A line that comes back: the rent every 5th, the cleaner every week. */
export interface Recurring {
  id: string;
  amountCents: number;
  currency: Currency;
  pocketId: string;
  categoryId?: string;
  label?: string;
  /** RFC 5545 RRULE value, read by the Agenda's own engine (doc 168). */
  rrule: string;
  /** The first due day. */
  start: Day;
  origin: Origin;
  review?: true;
  createdAt: string;
  updatedAt: string;
}

/** How much one unit of a currency is worth in the base currency, as the person typed it. */
export interface Rate {
  /** What 1 unit of the currency is worth in the base currency (1 MAD = 0.092 EUR → 0.092). */
  value: number;
  /** The day the person read that rate. A total says it. */
  day: Day;
  /**
   * The person typed the rate the other way round (« 1 EUR = 10,8 MAD »): the
   * screen shows it that way again. `value` is still base-per-unit. Absent
   * when it was typed as « 1 MAD = 0,092 EUR ».
   */
  typedAsBase?: true;
}

export interface BudgetSettings {
  version: 1;
  baseCurrency: Currency;
  pockets: Pocket[];
  /** Keyed by currency code. A currency absent here is never converted. */
  rates: Record<Currency, Rate>;
  /**
   * The currencies the person pays in besides the base (the children's MAD,
   * a USD supplier), offered as tiles when a line is written. A currency may
   * be here without a rate: its lines are then counted apart. Absent = none.
   */
  currencies?: Currency[];
  /** Validated lines are written into the cartridge's own vault. */
  memory: boolean;
}
