import { useEffect, useRef } from 'react';
import { sdk } from '../data/host';
import type { Budget } from '../data/useBudget';
import { getLanguage, translate } from '../i18n';
import { addExpense, correctExpense, markPaid, planExpense, setBudget, summary, type Book, type Change, type Ctx } from '../model/agent';
import { knownCurrencies } from '../model/currencies';
import { localDay } from '../model/dates';
import type { Month } from '../model/types';

/** What the screen offers an agent: show a month, and a pocket in it. */
export interface BudgetAgentView {
  show: (target: { month: Month; pocketId?: string }) => void;
}

/**
 * What an agent may do in the budget (doc 149, doc 177 §5), declared in
 * `mnemo-plugin.json` › agentActions and served while the window is open (the
 * host opens a closed window for the call, doc 149 §9). Each handler is a
 * pure function of model/agent.ts; the line is written through the budget's
 * own save, the one the person's buttons use, then shown.
 *
 * The answer carries `say`: the orb speaks the app's sentence, built from
 * its sums, never the planner's (doc 177 §3 rule 1). Renders nothing.
 */
export function BudgetAgentActions({ budget, view }: { budget: Budget; view: BudgetAgentView }) {
  const latest = useRef({ budget, view });
  latest.current = { budget, view };

  useEffect(() => {
    const context = (): { book: Book; ctx: Ctx } => {
      const b = latest.current.budget;
      // Served from the first screen on (doc 177 §11): with no folder chosen yet, the person hears why, not a timeout.
      // 🚨 Still reading the folder (the host opened the window FOR this call, doc 149 §9): a wait the host
      //    retries by itself, never « choose a folder » said to someone who chose one (field, 2026-10-26).
      if (b.status.kind === 'booting' || b.status.kind === 'loading') throw new Error('NOT_READY: the budget is being read; call again in a moment');
      if (b.status.kind === 'error') throw new Error(`TO_PERSON: ${translate('error.title')}`);
      if (b.status.kind !== 'ready') throw new Error(`TO_PERSON: ${translate('say.noFolder')}`);
      const { settings, entries, recurring } = b.latest.current;
      if (!settings) throw new Error(`TO_PERSON: ${translate('say.noFolder')}`);
      return {
        book: { settings, entries, recurring },
        ctx: { today: localDay(), now: new Date().toISOString(), lang: getLanguage(), t: translate },
      };
    };

    /** Writes what a change holds (settings first: a new category before the line that names it), then shows it. */
    const apply = async (change: Change) => {
      const b = latest.current.budget;
      let settings = change.settings;
      // « 80 dirhams » said for the first time: MAD joins the tiles the dialog offers, as a typed line would.
      const currency = (change.entry ?? change.recurring)?.currency;
      const known = settings ?? b.latest.current.settings;
      if (currency && known && !knownCurrencies(known).includes(currency)) settings = { ...known, currencies: [...(known.currencies ?? []), currency] };
      if (settings && !(await b.saveSettings(settings))) throw new Error('WRITE_FAILED: the settings could not be saved; the reason is on the person\'s screen');
      if (change.entry && !(await b.saveEntry(change.entry))) throw new Error('WRITE_FAILED: the line could not be saved; the reason is on the person\'s screen');
      if (change.recurring && !(await b.saveRecurring(change.recurring))) throw new Error('WRITE_FAILED: the line could not be saved; the reason is on the person\'s screen');
      latest.current.view.show(change.show);
      return {
        say: change.say,
        ...(change.entry ? { lineId: change.entry.id, status: change.entry.status } : {}),
        ...(change.recurring ? { recurringId: change.recurring.id } : {}),
      };
    };

    if (typeof sdk.onAgentActions !== 'function') {
      // An iframe served an older SDK build: it must not take the window down.
      console.warn('[mnemo-budget] this SDK build has no onAgentActions; reload the cartridge to serve agent actions');
      return undefined;
    }

    const sub = sdk.onAgentActions({
      addExpense: async (args) => {
        const { book, ctx } = context();
        return apply(addExpense(book, args, ctx));
      },
      planExpense: async (args) => {
        const { book, ctx } = context();
        return apply(planExpense(book, args, ctx));
      },
      markPaid: async (args) => {
        const { book, ctx } = context();
        return apply(markPaid(book, args, ctx));
      },
      correctExpense: async (args) => {
        const { book, ctx } = context();
        return apply(correctExpense(book, args, ctx));
      },
      setBudget: async (args) => {
        const { book, ctx } = context();
        return apply(setBudget(book, args, ctx));
      },
      summary: (args) => {
        const { book, ctx } = context();
        const read = summary(book, args, ctx);
        latest.current.view.show(read.show);
        return { say: read.say, ...read.figures };
      },
    });
    sub.ready.catch((err: unknown) => console.warn('[mnemo-budget] agent actions not served:', err instanceof Error ? err.message : err));
    return () => sub.off();
  }, []);

  return null;
}
