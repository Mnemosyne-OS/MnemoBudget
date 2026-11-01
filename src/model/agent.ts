/**
 * What the orb (and any agent) may do in the budget (doc 177 §5), as pure
 * functions: each takes the budget and the arguments, and answers the record
 * to write and the line to say. The component saves through the budget's own
 * save, the one the person's buttons use.
 *
 * 🚨 Rule 1: every figure in a spoken line comes from monthSummary over the
 *    files, never from the model (the orb says the app's `say`).
 * 🚨 Rule 2: a line an agent writes waits for review (`review: true`).
 * 🚨 Rule 3: never guessed. No pocket said and no category that names one →
 *    the person is ASKED (TO_PERSON: the orb says it), never the first pocket.
 * 🚨 Rule 6: nothing here deletes.
 */
import { findNamed, namesMatch, type Named } from '../data/agentFind';
import { addMonths, monthOf, parseSpokenDay, parseSpokenMonth } from './dates';
import { hasUnconverted, monthSummary, plannedLines, type Amounts, type PlannedLine } from './ledger';
import { centsFromNumber, formatMoney, normalizeCurrency } from './money';
import { newId } from './records';
import { REPEATS, repeatOf, ruleFor, type Repeat } from './recurrence';
import type { BudgetSettings, Category, Currency, Day, Entry, Month, Pocket, Recurring } from './types';

export interface Book {
  settings: BudgetSettings;
  entries: Entry[];
  recurring: Recurring[];
}

export interface Ctx {
  today: Day;
  /** ISO instant for createdAt / updatedAt. */
  now: string;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export interface Change {
  settings?: BudgetSettings;
  entry?: Entry;
  recurring?: Recurring;
  say: string;
  /** What to show on screen after the change. */
  show: { month: Month; pocketId?: string };
}

type Args = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** A refusal the orb SAYS to the person, never handed to the repair planner. */
const toPerson = (text: string) => new Error(`TO_PERSON: ${text}`);

function money(cents: number, currency: Currency, ctx: Ctx) {
  return formatMoney(cents, currency, ctx.lang);
}

function amountOf(args: Args, key = 'amount'): number {
  const cents = centsFromNumber(args[key]);
  if (cents === null) throw new Error(`BAD_ARG: "${key}" must be an amount above 0`);
  return cents;
}

function currencyOf(args: Args, book: Book, ctx: Ctx): Currency {
  const said = str(args.currency);
  if (!said) return book.settings.baseCurrency;
  const code = normalizeCurrency(said);
  if (!code) throw toPerson(ctx.t('say.unknownCurrency', { currency: said }));
  return code;
}

// ── Pockets and categories ────────────────────────────────────────────────

export interface Target {
  pocket: Pocket;
  category?: Category;
  /** The category did not exist and was created in the pocket. */
  created?: true;
}

const pocketEntries = (s: BudgetSettings): Array<Named<Pocket>> => s.pockets.map((p) => ({ item: p, id: p.id, names: [p.name], label: p.name }));
const categoryEntries = (pocket: Pocket): Array<Named<Category>> => pocket.categories.map((c) => ({ item: c, id: c.id, names: [c.name], label: c.name }));

function askPocket(book: Book, ctx: Ctx): Error {
  return toPerson(ctx.t('say.whichPocket', { pockets: book.settings.pockets.map((p) => p.name).join(', ') }));
}

/**
 * The pocket and category the words name. `create`: a category the pocket
 * lacks is created (and said); otherwise it is refused with what exists.
 */
export function resolveTarget(book: Book, pocketRef: string, categoryRef: string, ctx: Ctx, create: boolean): Target {
  const { settings } = book;
  if (!settings.pockets.length) throw toPerson(ctx.t('say.noPockets'));
  let pocket: Pocket | undefined;
  if (pocketRef) pocket = findNamed(pocketEntries(settings), pocketRef, { code: 'NO_POCKET', noun: 'pocket' });

  if (!pocket) {
    if (!categoryRef) {
      if (settings.pockets.length === 1) return { pocket: settings.pockets[0]! };
      throw askPocket(book, ctx);
    }
    // A category said alone (« le chien »): the pocket that holds it.
    const all: Array<Named<{ pocket: Pocket; category: Category }>> = settings.pockets.flatMap((p) => p.categories.map((c) => ({
      item: { pocket: p, category: c }, id: c.id, names: [c.name], label: `${c.name} (${p.name})`,
    })));
    try {
      const hit = findNamed(all, categoryRef, { code: 'NO_CATEGORY', noun: 'category' });
      return { pocket: hit.pocket, category: hit.category };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('AMBIGUOUS')) throw err;
    }
    // The word may name a pocket (« pour le restaurant » taken for a category).
    try {
      return { pocket: findNamed(pocketEntries(settings), categoryRef, { code: 'NO_POCKET', noun: 'pocket' }) };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('AMBIGUOUS')) throw err;
    }
    throw askPocket(book, ctx);
  }

  if (!categoryRef) return { pocket };
  try {
    return { pocket, category: findNamed(categoryEntries(pocket), categoryRef, { code: 'NO_CATEGORY', noun: 'category' }) };
  } catch (err) {
    if (!create || !(err instanceof Error) || !err.message.startsWith('NO_CATEGORY')) throw err;
  }
  const name = categoryRef.charAt(0).toUpperCase() + categoryRef.slice(1);
  return { pocket, category: { id: newId('c'), name: name.slice(0, 80) }, created: true };
}

/** The settings with a category added to its pocket. */
function withCategory(settings: BudgetSettings, pocketId: string, category: Category): BudgetSettings {
  return { ...settings, pockets: settings.pockets.map((p) => (p.id === pocketId ? { ...p, categories: [...p.categories, category] } : p)) };
}

function where(target: { pocket: Pocket; category?: Category }): string {
  return target.category ? `${target.category.name} (${target.pocket.name})` : target.pocket.name;
}

// ── Spoken lines built from the sums ──────────────────────────────────────

function amountsText(a: Amounts, base: Currency, ctx: Ctx): string {
  const floor = hasUnconverted(a) ? '≥ ' : '';
  return `${floor}${money(a.cents, base, ctx)}`;
}

function unconvertedText(a: Amounts, ctx: Ctx): string {
  const parts = Object.entries(a.unconverted).map(([cur, u]) => ctx.t(u.count === 1 ? 'say.unconverted.one' : 'say.unconverted.many', { count: u.count, currency: cur }));
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** What is left on the category's cap this month, once `extra` is counted. Empty when no cap is set. */
function capLine(book: Book, pocketId: string, category: Category | undefined, month: Month, ctx: Ctx): string {
  if (!category || category.capCents === undefined) return '';
  const s = monthSummary(book.settings, book.entries, book.recurring, month, ctx.today);
  const line = s.pockets.find((p) => p.pocket.id === pocketId)?.categories.find((c) => c.category?.id === category.id);
  if (!line) return '';
  const left = category.capCents - line.spent.cents;
  const base = book.settings.baseCurrency;
  const ceiling = hasUnconverted(line.spent) ? '≤ ' : '';
  return left >= 0
    ? ` ${ctx.t('say.capLeft', { left: `${ceiling}${money(left, base, ctx)}`, category: category.name })}`
    : ` ${ctx.t('say.capOver', { over: money(-left, base, ctx), category: category.name })}`;
}

// ── The actions ───────────────────────────────────────────────────────────

/** « J'ai payé 80 € de croquettes pour le chien »: a PAID line, to review; the cap left is said from the sums. */
export function addExpense(book: Book, args: Args, ctx: Ctx): Change {
  const amountCents = amountOf(args);
  const currency = currencyOf(args, book, ctx);
  const daySaid = str(args.day);
  const parsed = daySaid ? parseSpokenDay(daySaid, ctx.today, 'past') : { day: ctx.today };
  if (!parsed) throw toPerson(ctx.t('say.unknownDay', { day: daySaid }));
  if (parsed.day > ctx.today) throw toPerson(ctx.t('say.paidInFuture'));
  const target = resolveTarget(book, str(args.pocket), str(args.category), ctx, true);
  const label = str(args.label).slice(0, 200);
  const entry: Entry = {
    id: newId('e'), status: 'paid', amountCents, currency, day: parsed.day, pocketId: target.pocket.id, origin: 'agent', review: true,
    createdAt: ctx.now, updatedAt: ctx.now,
    ...(target.category ? { categoryId: target.category.id } : {}),
    ...(label ? { label } : {}),
  };
  const settings = target.created && target.category ? withCategory(book.settings, target.pocket.id, target.category) : undefined;
  const after: Book = { settings: settings ?? book.settings, entries: [...book.entries, entry], recurring: book.recurring };
  const say = ctx.t(target.created ? 'say.added.newCategory' : 'say.added', {
    amount: money(amountCents, currency, ctx), where: where(target), label: label ? ` ${label}` : '',
  }) + capLine(after, target.pocket.id, target.category, monthOf(entry.day), ctx);
  return { entry, ...(settings ? { settings } : {}), say, show: { month: monthOf(entry.day), pocketId: target.pocket.id } };
}

/** « Je prévois 300 € en décembre », « le loyer c'est 1200 € tous les 5 »: a plan, or a line that comes back (`repeat`). Never counted as spent. */
export function planExpense(book: Book, args: Args, ctx: Ctx): Change {
  const amountCents = amountOf(args);
  const currency = currencyOf(args, book, ctx);
  const whenSaid = str(args.when);
  const parsed = whenSaid ? parseSpokenDay(whenSaid, ctx.today, 'future') : null;
  if (!parsed) throw toPerson(ctx.t(whenSaid ? 'say.unknownDay' : 'say.whenPlanned', { day: whenSaid }));
  const repeatSaid = str(args.repeat);
  const repeat = REPEATS.includes(repeatSaid as Repeat) ? (repeatSaid as Repeat) : null;
  if (repeatSaid && !repeat) throw new Error(`BAD_ARG: repeat is weekly, monthly or yearly, not "${repeatSaid}"`);
  const target = resolveTarget(book, str(args.pocket), str(args.category), ctx, true);
  const label = str(args.label).slice(0, 200);
  const settings = target.created && target.category ? withCategory(book.settings, target.pocket.id, target.category) : undefined;
  const common = {
    amountCents, currency, pocketId: target.pocket.id, origin: 'agent' as const, review: true as const, createdAt: ctx.now, updatedAt: ctx.now,
    ...(target.category ? { categoryId: target.category.id } : {}),
    ...(label ? { label } : {}),
  };
  const vars = { amount: money(amountCents, currency, ctx), where: where(target), label: label ? ` ${label}` : '' };
  if (repeat) {
    const recurring: Recurring = { id: newId('r'), ...common, rrule: ruleFor(repeat, parsed.day), start: parsed.day };
    return {
      recurring, ...(settings ? { settings } : {}),
      say: ctx.t(`say.planned.${repeat}`, { ...vars, day: Number(parsed.day.slice(8)), weekday: weekdayName(parsed.day, ctx.lang) }),
      show: { month: monthOf(parsed.day), pocketId: target.pocket.id },
    };
  }
  const entry: Entry = { id: newId('e'), status: 'planned', day: parsed.day, ...(parsed.wholeMonth ? { wholeMonth: true as const } : {}), ...common };
  return {
    entry, ...(settings ? { settings } : {}),
    say: ctx.t('say.planned.once', { ...vars, when: whenText(entry, ctx.lang) }),
    show: { month: monthOf(parsed.day), pocketId: target.pocket.id },
  };
}

/** « mardi » for a day, in the person's language. */
export function weekdayName(day: Day, lang: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(y, m - 1, d));
}

/** « le 5 novembre », « en décembre ». */
export function whenText(entry: { day: Day; wholeMonth?: true }, lang: string): string {
  const [y, m, d] = entry.day.split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  return entry.wholeMonth
    ? new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(at)
    : new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' }).format(at);
}

function plannedLabel(line: PlannedLine, settings: BudgetSettings): { names: string[]; label: string } {
  const pocket = settings.pockets.find((p) => p.id === line.pocketId);
  const category = pocket?.categories.find((c) => c.id === line.categoryId);
  const names = [line.label, category?.name, pocket?.name].filter((n): n is string => !!n);
  return { names, label: `${names.join(' · ')} ${line.day}` };
}

/** How far ahead « j'ai payé les vacances » looks for a plan: a year. */
const PLANS_AHEAD_MONTHS = 12;

/**
 * The plan `what` names among `lines`, or null when none does. Several hits
 * that are occurrences of ONE recurring line (two Tuesdays of the cleaner) are
 * the earliest; several different plans are refused AMBIGUOUS with their names.
 */
function pickPlan(lines: readonly PlannedLine[], what: string, settings: BudgetSettings): PlannedLine | null {
  const named: Array<Named<PlannedLine>> = lines.map((l) => ({ item: l, id: l.entry?.id ?? l.key, ...plannedLabel(l, settings) }));
  const hits = named.filter((n) => namesMatch(n, what)).map((n) => n.item);
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0]!;
  if (new Set(hits.map((h) => h.recurring?.id ?? h.key)).size === 1) return [...hits].sort((a, b) => (a.day < b.day ? -1 : 1))[0]!;
  // findNamed words the refusal (and prefers a name said whole over a partial one).
  return findNamed(named.filter((n) => hits.includes(n.item)), what, { code: 'NO_PLAN', noun: 'plan' });
}

/**
 * « J'ai payé le loyer ». This month's plans first, the ones left unpaid
 * before it included. Only when none of them is named does it look ahead
 * (the rent of the 1st paid on the 30th, the holidays paid in October), and
 * then the spoken line SAYS which due date was paid: paying November's rent
 * by repeating a sentence must never pass in silence (verifier, 2026-10-24).
 */
export function markPaid(book: Book, args: Args, ctx: Ctx): Change {
  const month = monthOf(ctx.today);
  const what = str(args.what);
  if (!what) throw new Error('BAD_ARG: name the plan that was paid');
  const now = plannedLines(book.entries, book.recurring, month, ctx.today);
  const seen = new Set(now.map((l) => l.key));
  const later: PlannedLine[] = [];
  for (let i = 1; i <= PLANS_AHEAD_MONTHS; i++) {
    for (const l of plannedLines(book.entries, book.recurring, addMonths(month, i), ctx.today)) {
      if (!seen.has(l.key)) { seen.add(l.key); later.push(l); }
    }
  }
  if (!now.length && !later.length) throw toPerson(ctx.t('say.noPlans'));
  let line = pickPlan(now, what, book.settings);
  const ahead = !line;
  if (!line) line = pickPlan(later, what, book.settings);
  if (!line) {
    const names = [...now, ...later].slice(0, 12).map((l) => plannedLabel(l, book.settings).label);
    throw new Error(`NO_PLAN: no plan named "${what}"; plans: ${names.join(', ')}`);
  }
  const daySaid = str(args.day);
  const parsed = daySaid ? parseSpokenDay(daySaid, ctx.today, 'past') : { day: ctx.today };
  if (!parsed) throw toPerson(ctx.t('say.unknownDay', { day: daySaid }));
  if (parsed.day > ctx.today) throw toPerson(ctx.t('say.paidInFuture'));
  const amountCents = args.amount === undefined ? line.amountCents : amountOf(args);
  let entry: Entry;
  if (line.entry) {
    entry = { ...line.entry, status: 'paid', day: parsed.day, amountCents, review: true, updatedAt: ctx.now };
    // « In December » named a month to pay in; paid, the line has its day.
    delete entry.wholeMonth;
  } else {
    const r = line.recurring!;
    entry = {
      id: newId('e'), status: 'paid', amountCents, currency: r.currency, day: parsed.day, pocketId: r.pocketId, origin: 'agent', review: true,
      recurringId: r.id, occurrence: line.day, createdAt: ctx.now, updatedAt: ctx.now,
      ...(r.categoryId ? { categoryId: r.categoryId } : {}),
      ...(r.label ? { label: r.label } : {}),
    };
  }
  const vars = { amount: money(amountCents, entry.currency, ctx), where: where(targetOf(book.settings, line.pocketId, line.categoryId, ctx)), label: entry.label ? ` ${entry.label}` : '' };
  return {
    entry,
    say: ahead ? ctx.t('say.paid.ahead', { ...vars, when: whenText(line, ctx.lang) }) : ctx.t('say.paid', vars),
    show: { month: monthOf(entry.day), pocketId: entry.pocketId },
  };
}

/** The pocket and category a line names, for a spoken line; a removed pocket is said as removed. */
function targetOf(settings: BudgetSettings, pocketId: string, categoryId: string | undefined, ctx: Ctx): Target {
  const pocket = settings.pockets.find((p) => p.id === pocketId);
  const category = pocket?.categories.find((c) => c.id === categoryId);
  return { pocket: pocket ?? { id: pocketId, name: ctx.t('pocket.missing'), categories: [] }, ...(category ? { category } : {}) };
}

type Line = { kind: 'entry'; item: Entry } | { kind: 'recurring'; item: Recurring };

/**
 * « Non, c'était 18 € ». Without `what`, the LAST line written, a paid or
 * planned line OR a line that comes back: « le loyer c'est 1200 € tous les
 * 5 » then « non, 1300 » corrects the rent, never the dog food written that
 * morning (verifier, 2026-10-24). Several lines with the same words: the one
 * written last. The corrected line goes back to review.
 */
export function correctExpense(book: Book, args: Args, ctx: Ctx): Change {
  const what = str(args.what);
  const all: Line[] = [
    ...book.entries.map((item) => ({ kind: 'entry' as const, item })),
    ...book.recurring.map((item) => ({ kind: 'recurring' as const, item })),
  ];
  const latestFirst = (list: Line[]) => [...list].sort((a, b) => (a.item.updatedAt < b.item.updatedAt ? 1 : a.item.updatedAt > b.item.updatedAt ? -1 : 0));
  let line: Line | undefined;
  if (what) {
    const named: Array<Named<Line>> = all.map((l) => {
      const t = targetOf(book.settings, l.item.pocketId, l.item.categoryId, ctx);
      const names = [l.item.label, t.category?.name, t.pocket.name].filter((n): n is string => !!n);
      const day = l.kind === 'entry' ? l.item.day : l.item.start;
      return { item: l, id: l.item.id, names, label: `${names.join(' · ')} ${day} ${money(l.item.amountCents, l.item.currency, ctx)}` };
    });
    const hits = named.filter((n) => namesMatch(n, what)).map((n) => n.item);
    if (!hits.length) findNamed(named, what, { code: 'NO_LINE', noun: 'line' });
    line = latestFirst(hits)[0];
  } else {
    line = latestFirst(all)[0];
  }
  if (!line) throw toPerson(ctx.t('say.nothingToCorrect'));

  const current = line.item;
  const next = { ...current, review: true as const, updatedAt: ctx.now };
  if (args.amount !== undefined) next.amountCents = amountOf(args);
  if (str(args.currency)) next.currency = currencyOf(args, book, ctx);
  if (str(args.label)) next.label = str(args.label).slice(0, 200);

  let settings: BudgetSettings | undefined;
  const pocketSaid = str(args.pocket);
  const categorySaid = str(args.category);
  if (pocketSaid || categorySaid) {
    const currentPocket = book.settings.pockets.find((p) => p.id === current.pocketId);
    // A category said alone is looked for in the line's own pocket first, then anywhere; else created where the line is.
    const target = pocketSaid || !currentPocket
      ? resolveTarget(book, pocketSaid, categorySaid, ctx, true)
      : (() => {
        try {
          return resolveTarget(book, currentPocket.id, categorySaid, ctx, false);
        } catch (err) {
          if (!(err instanceof Error) || !err.message.startsWith('NO_CATEGORY')) throw err;
        }
        try {
          return resolveTarget(book, '', categorySaid, ctx, false);
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('AMBIGUOUS')) throw err;
        }
        return resolveTarget(book, currentPocket.id, categorySaid, ctx, true);
      })();
    next.pocketId = target.pocket.id;
    if (target.category) next.categoryId = target.category.id;
    // A move to another pocket keeps a category only if that pocket has it.
    else if (!target.pocket.categories.some((c) => c.id === next.categoryId)) delete next.categoryId;
    if (target.created && target.category) settings = withCategory(book.settings, target.pocket.id, target.category);
  }

  const daySaid = str(args.day);
  const s = settings ?? book.settings;
  const vars = () => ({ amount: money(next.amountCents, next.currency, ctx), where: where(targetOf(s, next.pocketId, next.categoryId, ctx)), label: next.label ? ` ${next.label}` : '' });

  if (line.kind === 'recurring') {
    const rec = next as Recurring;
    if (daySaid) {
      const parsed = parseSpokenDay(daySaid, ctx.today, 'future');
      if (!parsed) throw toPerson(ctx.t('say.unknownDay', { day: daySaid }));
      // The same rhythm from the new first due day.
      rec.start = parsed.day;
      rec.rrule = ruleFor(repeatOf(line.item.rrule) ?? 'monthly', parsed.day);
    }
    return { recurring: rec, ...(settings ? { settings } : {}), say: ctx.t('say.corrected', vars()), show: { month: monthOf(ctx.today), pocketId: rec.pocketId } };
  }

  const entry = next as Entry;
  if (daySaid) {
    const paid = line.item.status === 'paid';
    const parsed = parseSpokenDay(daySaid, ctx.today, paid ? 'past' : 'future');
    if (!parsed) throw toPerson(ctx.t('say.unknownDay', { day: daySaid }));
    if (paid && parsed.day > ctx.today) throw toPerson(ctx.t('say.paidInFuture'));
    entry.day = parsed.day;
    if (!paid) {
      if (parsed.wholeMonth) entry.wholeMonth = true;
      else delete entry.wholeMonth;
    }
  }
  return { entry, ...(settings ? { settings } : {}), say: ctx.t('say.corrected', vars()), show: { month: monthOf(entry.day), pocketId: entry.pocketId } };
}

/** « 120 € par mois pour le chien »: a category's monthly cap; what is left is said from the sums. */
export function setBudget(book: Book, args: Args, ctx: Ctx): Change {
  const capCents = amountOf(args);
  const target = resolveTarget(book, str(args.pocket), str(args.category), ctx, !!str(args.pocket));
  if (!target.category) throw toPerson(ctx.t('say.whichCategory', { pocket: target.pocket.name, categories: target.pocket.categories.map((c) => c.name).join(', ') }));
  const category: Category = { ...target.category, capCents };
  const base = target.created ? withCategory(book.settings, target.pocket.id, target.category) : book.settings;
  const settings: BudgetSettings = {
    ...base,
    pockets: base.pockets.map((p) => (p.id !== target.pocket.id ? p : { ...p, categories: p.categories.map((c) => (c.id === category.id ? category : c)) })),
  };
  const month = monthOf(ctx.today);
  const after: Book = { ...book, settings };
  return {
    settings,
    say: ctx.t('say.capSet', { amount: money(capCents, settings.baseCurrency, ctx), category: category.name }) + capLine(after, target.pocket.id, category, month, ctx),
    show: { month, pocketId: target.pocket.id },
  };
}

/** A read: the sums of a month, of a pocket or of a category, said and shown. */
export function summary(book: Book, args: Args, ctx: Ctx): { say: string; show: { month: Month; pocketId?: string }; figures: Record<string, unknown> } {
  const monthSaid = str(args.month);
  const month = monthSaid ? parseSpokenMonth(monthSaid, ctx.today) : monthOf(ctx.today);
  if (!month) throw toPerson(ctx.t('say.unknownMonth', { month: monthSaid }));
  const s = monthSummary(book.settings, book.entries, book.recurring, month, ctx.today);
  const base = book.settings.baseCurrency;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const monthName = new Intl.DateTimeFormat(ctx.lang, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  const review = s.review.length + s.reviewRecurring.length;
  /** The lines still to review among those the answer counts (a pocket's, a category's, or all). */
  const reviewIn = (keep: (l: { pocketId: string; categoryId?: string }) => boolean) => {
    const n = s.review.filter(keep).length + s.reviewRecurring.filter(keep).length;
    return n ? ` ${ctx.t(n === 1 ? 'say.review.one' : 'say.review.many', { count: n })}` : '';
  };
  const reviewText = reviewIn(() => true);

  const pocketSaid = str(args.pocket);
  const categorySaid = str(args.category);
  if (pocketSaid || categorySaid) {
    const target = resolveTarget(book, pocketSaid, categorySaid, ctx, false);
    const line = s.pockets.find((p) => p.pocket.id === target.pocket.id)!;
    if (target.category) {
      const cat = line.categories.find((c) => c.category?.id === target.category!.id)!;
      const cap = target.category.capCents;
      const capText = cap === undefined ? '' : ` ${cap - cat.spent.cents >= 0
        ? ctx.t('say.capLeft', { left: `${hasUnconverted(cat.spent) ? '≤ ' : ''}${money(cap - cat.spent.cents, base, ctx)}`, category: target.category.name })
        : ctx.t('say.capOver', { over: money(cat.spent.cents - cap, base, ctx), category: target.category.name })}`;
      return {
        say: ctx.t('say.summary.part', { what: where(target), month: monthName, spent: amountsText(cat.spent, base, ctx), planned: amountsText(cat.planned, base, ctx) })
          + capText + unconvertedText(cat.spent, ctx) + reviewIn((l) => l.pocketId === target.pocket.id && l.categoryId === target.category!.id),
        show: { month, pocketId: target.pocket.id },
        figures: { month, pocket: target.pocket.name, category: target.category.name, spentCents: cat.spent.cents, plannedCents: cat.planned.cents, capCents: cap ?? null, unconverted: cat.spent.unconverted },
      };
    }
    return {
      say: ctx.t('say.summary.part', { what: target.pocket.name, month: monthName, spent: amountsText(line.spent, base, ctx), planned: amountsText(line.planned, base, ctx) })
        + unconvertedText(line.spent, ctx) + reviewIn((l) => l.pocketId === target.pocket.id),
      show: { month, pocketId: target.pocket.id },
      figures: { month, pocket: target.pocket.name, spentCents: line.spent.cents, plannedCents: line.planned.cents, unconverted: line.spent.unconverted },
    };
  }

  const remaining = s.remainingCents === undefined ? '' : ` ${s.remainingCents >= 0
    ? ctx.t('say.remaining', { left: `${s.remainingIsCeiling ? '≤ ' : ''}${money(s.remainingCents, base, ctx)}` })
    : ctx.t('say.overall.over', { over: money(-s.remainingCents, base, ctx) })}`;
  return {
    say: ctx.t('say.summary.month', { month: monthName, spent: amountsText(s.spent, base, ctx), planned: amountsText(s.planned, base, ctx) })
      + remaining + unconvertedText(s.spent, ctx) + reviewText,
    show: { month },
    figures: {
      month, spentCents: s.spent.cents, plannedCents: s.planned.cents, remainingCents: s.remainingCents ?? null, unconverted: s.spent.unconverted, toReview: review,
      pockets: s.pockets.map((p) => ({ pocket: p.pocket.name || null, spentCents: p.spent.cents, plannedCents: p.planned.cents })),
    },
  };
}
