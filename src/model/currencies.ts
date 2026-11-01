/**
 * The currencies a person chooses from, and what happens to a budget when
 * its main currency changes. Pure.
 *
 * 🚨 Doc 177 §3 rule 4 holds here too: no rate is ever invented. A change of
 *    base converts the rates and the caps with ONE rate the person gave (or
 *    one they already had between the two currencies), and every currency
 *    that had no rate still has none afterwards.
 */
import { convert } from './money';
import type { BudgetSettings, Currency, Day, Rate } from './types';

/** Offered as tiles first; any ISO code can still be typed. */
export const COMMON_CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'GBP', 'CHF', 'MAD', 'DZD', 'TND', 'XOF', 'CAD', 'MXN', 'BRL', 'JPY', 'AED', 'THB'];

/** « € », « $ », « MAD »: what Intl prints for the code, or the code itself. */
export function currencySymbol(code: Currency, lang: string): string {
  try {
    const part = new Intl.NumberFormat(lang, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1).find((p) => p.type === 'currency');
    return part?.value ?? code;
  } catch (err) {
    console.warn('[mnemo-budget] no symbol for', code, err);
    return code;
  }
}

/** « dirham marocain »: the currency's name in the person's language, or the code when Intl has none. */
export function currencyName(code: Currency, lang: string): string {
  try {
    const names = new Intl.DisplayNames([lang], { type: 'currency', fallback: 'none' });
    return names.of(code) ?? code;
  } catch (err) {
    console.warn('[mnemo-budget] no name for', code, err);
    return code;
  }
}

/** A rate written for a screen: « 0,092 », « 10,8 », never a 15-digit float. */
export function formatRate(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { maximumSignificantDigits: 6 }).format(value);
}

/**
 * Every currency the budget knows: the base first, then the ones the person
 * uses, then the ones with a rate, then `extra` (a line's own currency).
 */
export function knownCurrencies(settings: BudgetSettings, ...extra: Array<Currency | undefined>): Currency[] {
  return [...new Set([settings.baseCurrency, ...(settings.currencies ?? []), ...Object.keys(settings.rates), ...extra.filter((c): c is Currency => !!c)])];
}

/**
 * The rate the budget already holds between its base and `code`, as « 1 base
 * = x code » (the direction a change of base needs), or null. A rate the
 * person typed for `code` reads the other way, so it is inverted here.
 */
export function linkToBase(settings: BudgetSettings, code: Currency): { value: number; day: Day } | null {
  const rate = settings.rates[code];
  if (!rate || rate.value <= 0) return null;
  return { value: 1 / rate.value, day: rate.day };
}

/**
 * The same budget counted in another currency. `link` is « 1 old base =
 * link.value new base », given by the person (or found by `linkToBase`).
 *
 * - The old base gets a rate (1 old = link.value new), dated `link.day`.
 * - Every other rate is carried across (x old per unit × link.value), dated
 *   the OLDER of its own day and `link.day`: a derived figure is only as
 *   fresh as its oldest source.
 * - A currency that had no rate still has none.
 * - Caps are converted with the link and rounded to the cent, so « 120 € a
 *   month for the dog » stays the same money; one that would fall under a
 *   cent is dropped (unset), never raised to a cent nobody chose.
 */
export function rebaseSettings(settings: BudgetSettings, newBase: Currency, link: { value: number; day: Day }): BudgetSettings {
  if (newBase === settings.baseCurrency) return settings;
  if (!(link.value > 0) || !Number.isFinite(link.value)) throw new Error('BAD_RATE');
  const oldBase = settings.baseCurrency;
  const rates: Record<Currency, Rate> = {};
  for (const [code, rate] of Object.entries(settings.rates)) {
    if (code === newBase) continue;
    rates[code] = { value: rate.value * link.value, day: rate.day < link.day ? rate.day : link.day };
  }
  rates[oldBase] = { value: link.value, day: link.day };
  const currencies = [...new Set([oldBase, ...(settings.currencies ?? [])])].filter((c) => c !== newBase);
  return {
    ...settings,
    baseCurrency: newBase,
    rates,
    currencies,
    pockets: settings.pockets.map((p) => ({
      ...p,
      categories: p.categories.map((c) => {
        if (c.capCents === undefined) return c;
        const converted = convert(c.capCents, oldBase, newBase, rates);
        // No rate (cannot happen: the old base just got one) or less than a cent once converted:
        // the cap goes rather than a figure nobody chose (🎭 `Math.max(1, …)` made one up).
        if (converted === null || converted < 1) {
          const { capCents: _dropped, ...rest } = c;
          return rest;
        }
        return { ...c, capCents: converted };
      }),
    })),
  };
}
