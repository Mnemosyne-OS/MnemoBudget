/**
 * Reading a till receipt from the text an OCR engine made of its photo
 * (doc 177 §14). Pure: the text goes in, what the ticket says comes out.
 *
 * 🎭 A field the ticket does not state is ABSENT, never guessed:
 *    - the amount is taken only from a line that NAMES the total (TOTAL TTC,
 *      À PAYER, CB…). The largest number on a receipt is often a subtotal or
 *      the cash tendered, so without such a line the amount is absent and
 *      every amount read is offered as a hint, nothing prefilled;
 *    - the date must be a day that exists, not after today and not older than
 *      two years (a loyalty card's expiry is a date too);
 *    - the category is a WORD match (the person's own names, or a short table
 *      of merchants per starter category), never the nearest one; two matches
 *      ask, none asks (doc 177 §3 rule 3).
 */
import { isDay } from './dates';
import { namesMatch } from '../data/agentFind';
import type { BudgetSettings, Category, Currency, Day, Pocket } from './types';

export interface ReceiptReading {
  /** The total, from a line that names it. Absent when none does. */
  amountCents?: number;
  /** The currency the ticket shows. Absent when none is written. */
  currency?: Currency;
  /** The day paid, when the ticket carries one that stands. */
  day?: Day;
  /** The first line that reads like a name, cut to 60 characters. */
  merchant?: string;
  /** Every amount with cents found, in reading order, for the hints. */
  amountsSeen: number[];
  /** The lines kept (trimmed, empty ones dropped). */
  lines: string[];
}

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** « 1 234,56 », « 12.30 », « 12,30€ »: cents, or null when the token is not an amount with cents. */
const AMOUNT = /(?<![\d,.])(\d{1,3}(?:[   .]\d{3})+|\d+)[,.](\d{2})(?![\d,.])/g;

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const units = Number(m[1]!.replace(/[   .]/g, ''));
    const cents = units * 100 + Number(m[2]);
    if (Number.isSafeInteger(cents) && cents > 0) out.push(cents);
  }
  return out;
}

/**
 * Lines that name the total, best first. A line naming a subtotal, a tax, a tip,
 * the cash tendered or the change never counts. FR/EN/ES first, then the words
 * the real tickets of the bench spoke (NL, DE, IT, PL: `tools/receipt-bench.ts`).
 */
const NEVER_TOTAL = /\b(sous[ -]?total|sub[ -]?total|sub[ -]?totaal|zwischensumme|total ht|hors taxe|especes|espece|cash|contant|rendu|monnaie|change|change due|ruckgeld|wisselgeld|remise|discount|tva|vat|iva|mwst|btw|ptu|tax|taxes|tip|gratuity|points?)\b/;
const TOTAL_RANKS: ReadonlyArray<{ rank: number; re: RegExp }> = [
  { rank: 3, re: /\b(net ?a ?payer|a payer|total ?a ?payer|total ?ttc|montant ?ttc|ttc|amount ?due|total ?due|balance ?due|grand ?total|total ?a ?pagar|a pagar|importe ?total|te betalen|zu zahlen|totale complessivo|importo pagato)\b/ },
  { rank: 2, re: /\b(total|totaal|totale|montant|amount|importe|importo|summe|gesamt|gesamtbetrag|betrag|bedrag|suma)\b/ },
  { rank: 1, re: /\b(cb|carte bancaire|carte|card|credit card|debit|visa|mastercard|maestro|tarjeta|paiement|payment|pago|pin|bankpas|girocard)\b/ },
];

/** « Tota1Due », « T0TAL »: a digit the engine put inside a word is the letter it looks like. */
function unmistakeDigits(folded: string): string {
  return folded.replace(/(?<=[a-z])[1|](?=[a-z])/g, 'l').replace(/(?<=[a-z])0(?=[a-z])/g, 'o');
}

function totalRank(folded: string): number {
  const f = unmistakeDigits(folded);
  if (NEVER_TOTAL.test(f)) return 0;
  for (const { rank, re } of TOTAL_RANKS) if (re.test(f)) return rank;
  return 0;
}

/**
 * 🚨 Measured on 18 real photos through the host's RapidOCR (2026-10-26): the
 * engine gives one box per piece of text and the host joins the boxes with a
 * newline, so the label of a row and its amount arrive as TWO lines, the amount
 * usually right after the label, sometimes just before it on a tilted photo.
 * A total line without an amount therefore takes the amount of the lone-amount
 * line that follows it (within three lines, stopping at the next label), else
 * the one just before it. Nothing is ever taken from a line that carries words.
 */
const CURRENCY_WORDS = new Set(['eur', 'euro', 'euros', 'chf', 'usd', 'dollar', 'dollars', 'mad', 'dirham', 'dirhams', 'dhs', 'gbp', 'pln', 'dzd', 'tnd', 'xof', 'fcfa']);
const AMOUNT_ONLY_REST = /^[\s:;*#_=.\-'"]*(?:€|\$|£|[a-z]{1,7})?[\s:;*#_=.\-'"]*$/;

/** The one amount a line carries when it carries nothing else but a currency mark: the amount box of a row. */
function amountOnly(folded: string): number | null {
  const amounts = amountsIn(folded);
  if (amounts.length !== 1 || /-\s*\d/.test(folded)) return null;
  const rest = folded.replace(AMOUNT, ' ');
  const m = AMOUNT_ONLY_REST.exec(rest);
  if (!m) return null;
  const word = rest.replace(/[^a-z]/g, '');
  // A lone « e » is the engine's reading of « € » (« E14,33 » on a Dutch ticket).
  return word === '' || word === 'e' || CURRENCY_WORDS.has(word) ? amounts[0]! : null;
}

/** A line that is the next row's label: four letters in a row that are not a currency word. */
function labelLike(folded: string): boolean {
  return (folded.match(/[a-z]{4,}/g) ?? []).some((w) => !CURRENCY_WORDS.has(w));
}

function amountBeside(folded: string[], i: number): number | null {
  for (let j = i + 1; j <= i + 3 && j < folded.length; j++) {
    const cents = amountOnly(folded[j]!);
    if (cents !== null) return cents;
    // Another total word without its amount (« Total » then « Visa ») shares the region: go on.
    if (labelLike(folded[j]!) && totalRank(folded[j]!) === 0) break;
  }
  // The lone amount just before counts only when it is not the amount of the row above
  // it (a label right before it): that one is an item's price, never the total's.
  if (i > 0 && !(i > 1 && labelLike(folded[i - 2]!))) return amountOnly(folded[i - 1]!);
  return null;
}

/** A currency word, glued to its number or not (« 8,48EUR »): bounded by letters, never by digits. */
const word = (alternatives: string) => new RegExp(`(?<![a-z])(?:${alternatives})(?![a-z])`);
const CURRENCY_MARKS: ReadonlyArray<{ re: RegExp; code: Currency }> = [
  { re: word('€|eur|euros?'), code: 'EUR' },
  { re: word('mad|dhs?|dirhams?'), code: 'MAD' },
  { re: word('\\$|usd|dollars?'), code: 'USD' },
  { re: word('£|gbp'), code: 'GBP' },
  { re: word('chf'), code: 'CHF' },
  { re: word('dzd'), code: 'DZD' },
  { re: word('tnd'), code: 'TND' },
  { re: word('xof|fcfa|cfa'), code: 'XOF' },
];

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, jun: 6, jul: 7, juil: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

const NUMERIC_DATE = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
const WORDED_DATE = new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{4}|\\d{2})\\b`, 'g');
const TIME = /\b([01]?\d|2[0-3])[:h][0-5]\d\b/;

function dayFrom(d: number, m: number, yRaw: number): Day | null {
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDay(day) ? day : null;
}

/** A till glues the time to the date in one box: « 29/04/201914:16 », « 15:2123.02.2019 », « 05/11/188:47PM ». */
function unglueTime(s: string): string {
  return s
    .replace(/(\d{4})(\d{1,2}:\d{2})/g, '$1 $2')
    .replace(/(\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2})(?=\d{1,2}:\d{2})/g, '$1 ')
    .replace(/(\d{1,2}:\d{2})(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/g, '$1 $2');
}

/**
 * The dates a line carries that exist, day-first (a till prints dd/mm; an ISO
 * date is read as such). A date that cannot be day-first (« 5/26/2016 ») is read
 * month-first: that reading is the only one that exists.
 */
function datesIn(folded: string): Day[] {
  const out: Day[] = [];
  for (const m of unglueTime(folded).matchAll(NUMERIC_DATE)) {
    const day = m[4]
      ? dayFrom(Number(m[6]), Number(m[5]), Number(m[4]))
      : dayFrom(Number(m[1]), Number(m[2]), Number(m[3])) ?? dayFrom(Number(m[2]), Number(m[1]), Number(m[3]));
    if (day) out.push(day);
  }
  for (const m of folded.matchAll(WORDED_DATE)) {
    const day = dayFrom(Number(m[1]), MONTHS[m[2]!]!, Number(m[3]));
    if (day) out.push(day);
  }
  return out;
}

function twoYearsBefore(today: Day): Day {
  return `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
}

/** Lines that are not a name: greetings, headers, legal mentions, addresses. */
const NOISE = /\b(ticket|recu|receipt|facture|invoice|bienvenue|welcome|bienvenido|merci|thank|gracias|tel|tele?phone|fax|siret|siren|rcs|tva|vat|iva|www|http|caisse|cashier|vendeur|client|customer|date|heure|hour|n[°o]\s*\d|rue|avenue|bd|boulevard|cedex|cp)\b/;

function looksLikeName(folded: string): boolean {
  const letters = (folded.match(/[a-z]/g) ?? []).length;
  const digits = (folded.match(/\d/g) ?? []).length;
  return letters >= 3 && letters > digits * 2 && !NOISE.test(folded) && !/\d{5}/.test(folded);
}

/** What the ticket says, field by field; see the file's rules. */
export function parseReceipt(text: string, today: Day): ReceiptReading {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const reading: ReceiptReading = { amountsSeen: [], lines };
  let best: { rank: number; cents: number } | null = null;
  const dated: Array<{ day: Day; withTime: boolean }> = [];
  const floor = twoYearsBefore(today);
  const folded = lines.map(fold);

  for (const [i, line] of lines.entries()) {
    const f = folded[i]!;
    const amounts = amountsIn(line);
    reading.amountsSeen.push(...amounts);
    const rank = totalRank(f);
    // The LAST line of the best rank wins: the final total is printed after the subtotals.
    if (rank > 0 && (!best || rank >= best.rank)) {
      const cents = amounts.length ? amounts[amounts.length - 1]! : amountBeside(folded, i);
      if (cents !== null) best = { rank, cents };
    }
    if (!reading.currency) {
      const mark = CURRENCY_MARKS.find((c) => c.re.test(f));
      if (mark) reading.currency = mark.code;
    }
    for (const day of datesIn(f)) {
      if (day <= today && day >= floor) dated.push({ day, withTime: TIME.test(unglueTime(f)) });
    }
  }
  if (best) reading.amountCents = best.cents;
  // A date beside a time of day is the till's stamp; else the first that stands.
  const stamped = dated.find((d) => d.withTime) ?? dated[0];
  if (stamped) reading.day = stamped.day;
  const name = lines.slice(0, 6).find((l) => looksLikeName(fold(l)));
  if (name) reading.merchant = name.replace(/[*#_=]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return reading;
}

/**
 * Merchants and words that name a starter category, by the names that
 * category has in the three languages (the person may have renamed it: then
 * only their own name matches, see `guessCategory`). Folded, lower case.
 */
const CATEGORY_WORDS: ReadonlyArray<{ names: string[]; words: string[] }> = [
  { names: ['courses', 'groceries', 'compra', 'alimentation'], words: ['carrefour', 'lidl', 'leclerc', 'auchan', 'intermarche', 'monoprix', 'franprix', 'casino', 'aldi', 'super u', 'hyper u', 'marche', 'supermarche', 'supermarket', 'supermarkt', 'supermercado', 'minimarket', 'mini market', 'epicerie', 'boulangerie', 'boucherie', 'primeur', 'picard', 'grand frais', 'biocoop', 'naturalia', 'marjane', 'acima', 'bim', 'mercadona', 'dia'] },
  { names: ['chien', 'dog', 'perro', 'animaux'], words: ['croquettes', 'animalerie', 'veterinaire', 'veto', 'truffaut', 'maxi zoo', 'maxizoo', 'botanic', 'jardiland', 'petshop', 'pet shop', 'royal canin'] },
  { names: ['sante', 'health', 'salud'], words: ['pharmacie', 'pharmacy', 'farmacia', 'parapharmacie', 'medecin', 'docteur', 'clinique', 'hopital', 'dentiste', 'optique', 'opticien', 'laboratoire', 'mutuelle'] },
  { names: ['ecole', 'school', 'escuela', 'enfants', 'children', 'ninos'], words: ['ecole', 'school', 'cantine', 'lycee', 'college', 'papeterie', 'fournitures scolaires', 'garderie', 'creche', 'periscolaire'] },
  { names: ['loyer', 'rent', 'alquiler', 'loyer du local', 'shop rent', 'alquiler del local'], words: ['loyer', 'quittance', 'bail', 'rent'] },
  { names: ['fournisseurs', 'suppliers', 'proveedores'], words: ['metro', 'promocash', 'transgourmet', 'sysco', 'grossiste', 'rungis', 'brake', 'davigel', 'pomona', 'cash and carry', 'makro'] },
  { names: ['menage', 'cleaning', 'limpieza'], words: ['menage', 'nettoyage', 'cleaning', 'pressing', 'laverie', 'blanchisserie'] },
  { names: ['salaires', 'wages', 'salarios'], words: ['salaire', 'paie', 'payslip', 'bulletin de paie', 'nomina'] },
  { names: ['restaurant', 'resto', 'restaurante'], words: ['restaurant', 'brasserie', 'bistro', 'pizzeria', 'kebab', 'mcdonald', 'burger', 'sushi', 'cafe', 'bar '] },
  { names: ['essence', 'carburant', 'fuel', 'gasolina', 'voiture', 'car', 'coche', 'transport'], // Not « station » alone: a till prints « Station:3 » for its own terminal (measured, §14.5).
    words: ['total energies', 'totalenergies', 'station service', 'station-service', 'station essence', 'gas station', 'tankstelle', 'esso', 'shell', 'bp ', 'carburant', 'gazole', 'diesel', 'sans plomb', 'sp95', 'sp98', 'parking', 'peage', 'autoroute', 'sncf', 'ratp', 'uber', 'taxi'] },
];

export type CategoryGuess = { pocket: Pocket; category: Category } | 'ambiguous' | null;

/**
 * The pocket and category the ticket names. The MERCHANT decides first (the
 * person's own names through `namesMatch`, the brick the orb uses, or the
 * table above); only a merchant nobody knows lets the item lines speak, by
 * the person's own names, then by the table. One answer, or 'ambiguous' (two
 * different ones) or null: both mean the person is asked, never the nearest
 * taken (doc 177 §3 rule 3).
 */
export function guessCategory(reading: ReceiptReading, settings: BudgetSettings): CategoryGuess {
  const merchant = fold(reading.merchant ?? '');
  const body = reading.lines.slice(0, 12).map(fold).join(' \n ');
  const pairs = settings.pockets.flatMap((pocket) => pocket.categories.map((category) => ({ pocket, category })));
  const named = (text: string) => pairs.filter(({ category }) => {
    const name = fold(category.name);
    return name.length >= 3 && new RegExp(`(^|[^a-z])${escape(name)}([^a-z]|$)`).test(text);
  });
  const tabled = (text: string) => CATEGORY_WORDS
    .filter((entry) => entry.words.some((w) => text.includes(w)))
    .flatMap((entry) => pairs.filter(({ category }) => entry.names.includes(fold(category.name))));
  const decide = (hits: Array<{ pocket: Pocket; category: Category }>): CategoryGuess | undefined => {
    const distinct = new Map(hits.map((h) => [`${h.pocket.id}|${h.category.id}`, h]));
    if (distinct.size === 1) return [...distinct.values()][0]!;
    if (distinct.size > 1) return 'ambiguous';
    return undefined;
  };
  if (merchant) {
    const own = pairs.filter(({ category }) => namesMatch({ item: category, id: category.id, names: [category.name], label: category.name }, reading.merchant!));
    const byMerchant = decide([...own, ...named(merchant), ...tabled(merchant)]);
    if (byMerchant !== undefined) return byMerchant;
  }
  return decide(named(body)) ?? decide(tabled(body)) ?? null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
