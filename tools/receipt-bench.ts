/**
 * The receipt parser against REAL OCR output (doc 177 §14.4): a folder of
 * `.txt` files, each the text the host's RapidOCR server gives for one photo
 * (one box per line, in the engine's order), goes through `parseReceipt` and
 * `guessCategory` with the starter pockets, and the result is printed as a
 * table. With `--truth=<json>` ({ "<id>": { "totalCents": 5658 } }, keyed by
 * the digits that start the file name) the amounts are scored.
 *
 * Run from the repo root, with the host's tsx (the cartridge has no node_modules
 * before its install):
 *   apps/infinity-edition/node_modules/.bin/tsx apps/mnemo-budget/tools/receipt-bench.ts <dir> [<dir>…] [--truth=<json>] [--show=<stem>]
 *
 * The receipts in a public set are years old, and the parser refuses a day older
 * than two years: the bench dates "today" from the latest year the text names, so
 * the day column says what the parser would have read the week of the receipt.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { guessCategory, parseReceipt } from '../src/model/receipt';
import type { BudgetSettings } from '../src/model/types';

const SETTINGS: BudgetSettings = {
  version: 1, baseCurrency: 'EUR', rates: {}, memory: false,
  pockets: [
    { id: 'home', name: 'Maison', icon: '🏠', categories: [
      { id: 'rent', name: 'Loyer' }, { id: 'groceries', name: 'Courses' }, { id: 'dog', name: 'Chien' }, { id: 'cleaner', name: 'Ménage' },
      { id: 'resto', name: 'Restaurant' }, { id: 'fuel', name: 'Essence' },
    ] },
    { id: 'family', name: 'Famille', icon: '👨‍👧', categories: [{ id: 'children', name: 'Enfants' }, { id: 'school', name: 'École' }, { id: 'health', name: 'Santé' }] },
    { id: 'work', name: 'Pro', icon: '💼', categories: [{ id: 'workRent', name: 'Loyer du local' }, { id: 'suppliers', name: 'Fournisseurs' }, { id: 'wages', name: 'Salaires' }] },
  ],
};

const args = process.argv.slice(2);
const dirs = args.filter((a) => !a.startsWith('--'));
const truthArg = args.find((a) => a.startsWith('--truth='));
const show = args.find((a) => a.startsWith('--show='))?.slice(7);
const truth: Record<string, { totalCents: number | null }> = truthArg ? JSON.parse(readFileSync(truthArg.slice(8), 'utf-8')) : {};

/** "Today" for a years-old receipt: the end of the year after the latest year the text names. */
function todayFor(text: string): string {
  // No boundary after the year: a till glues the time to it (« 29/04/201914:16 »).
  const years = [...text.matchAll(/(?<!\d)(20[0-2]\d)/g)].map((m) => Number(m[1])).filter((y) => y <= 2026);
  if (!years.length) return '2026-10-26';
  return `${Math.max(...years) + 1}-12-31`;
}

const cents = (c: number | undefined) => (c === undefined ? '' : (c / 100).toFixed(2));
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

let files = 0, withAmount = 0, scored = 0, right = 0, wrong = 0, missing = 0, withDay = 0, withMerchant = 0, withCategory = 0, ambiguous = 0;
const wrongOnes: string[] = [];
console.log([pad('file', 34), pad('amount', 9), pad('cur', 4), pad('day', 11), pad('merchant', 24), pad('category', 14), pad('seen', 5), pad('truth', 8), 'ok'].join(' '));
for (const dir of dirs) {
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    const text = readFileSync(join(dir, name), 'utf-8');
    const stem = basename(name, '.txt');
    const reading = parseReceipt(text, todayFor(text));
    const guess = guessCategory(reading, SETTINGS);
    const category = guess === null ? '' : guess === 'ambiguous' ? '(ambiguous)' : guess.category.name;
    files++;
    if (reading.amountCents !== undefined) withAmount++;
    if (reading.day) withDay++;
    if (reading.merchant) withMerchant++;
    if (guess && guess !== 'ambiguous') withCategory++;
    if (guess === 'ambiguous') ambiguous++;
    const id = /^\d+/.exec(stem)?.[0];
    const t = id ? truth[id]?.totalCents : undefined;
    let ok = '';
    if (typeof t === 'number') {
      scored++;
      if (reading.amountCents === t) { right++; ok = 'OK'; } else if (reading.amountCents === undefined) { missing++; ok = 'MISSING'; } else { wrong++; ok = 'WRONG'; wrongOnes.push(stem); }
    }
    console.log([pad(stem, 34), pad(cents(reading.amountCents), 9), pad(reading.currency ?? '', 4), pad(reading.day ?? '', 11), pad(reading.merchant ?? '', 24), pad(category, 14), pad(String(reading.amountsSeen.length), 5), pad(typeof t === 'number' ? cents(t) : '', 8), ok].join(' '));
    if (show && stem === show) {
      console.log('--- text ---');
      console.log(text);
      console.log('--- reading ---');
      console.log(JSON.stringify(reading, null, 1));
    }
  }
}
console.log('');
console.log(`${files} receipts: amount on ${withAmount}, day on ${withDay}, merchant on ${withMerchant}, category on ${withCategory} (${ambiguous} ambiguous)`);
if (scored) console.log(`scored against truth: ${scored}, right ${right}, wrong ${wrong}, missing ${missing}${wrongOnes.length ? `; wrong: ${wrongOnes.join(', ')}` : ''}`);
