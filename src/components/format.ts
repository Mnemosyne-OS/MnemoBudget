/**
 * Money, days and months as the screen writes them, in the person's language.
 */
import { hasUnconverted, type Amounts } from '../model/ledger';
import { formatMoney } from '../model/money';
import type { BudgetSettings, Currency, Day } from '../model/types';

/** Base-currency amounts; « ≥ » when lines without a rate are left out of the figure. */
export function amountsLabel(a: Amounts, base: Currency, lang: string): string {
  return `${hasUnconverted(a) ? '≥ ' : ''}${formatMoney(a.cents, base, lang)}`;
}

/** « 3 oct. » */
export function dayLabel(day: Day, lang: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

/** « octobre 2026 » */
export function monthLabel(month: string, lang: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

/** « oct. » */
export function monthShort(month: string, lang: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(y, m - 1, 1));
}

/** « +12 % », « −8 % », with the sign always written. */
export function percentLabel(percent: number, lang: string): string {
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: 0, signDisplay: 'always' }).format(percent);
  return `${n} %`;
}

/** The folder's last segment: « MnemoBudget » for « C:\Users\a\Documents\Mnemosyne Apps\MnemoBudget ». */
export function folderName(folder: string): string {
  const parts = folder.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || folder;
}

/** The pocket and category a line names, by name, for a row: « Chien · Maison ». */
export function placeOf(settings: BudgetSettings, pocketId: string, categoryId: string | undefined, t: (k: string) => string) {
  const pocket = settings.pockets.find((p) => p.id === pocketId);
  const category = pocket?.categories.find((c) => c.id === categoryId);
  return { pocket, category, text: [category?.name, pocket?.name ?? t('pocket.missing')].filter(Boolean).join(' · ') };
}
