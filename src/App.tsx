import { useCallback, useMemo, useRef, useState } from 'react';
import { BudgetAgentActions } from './components/BudgetAgentActions';
import { CurrencyPicker } from './components/CurrencyPicker';
import { DashboardView } from './components/DashboardView';
import { useFar } from './components/distance';
import { EntryDialog, type DialogResult, type DialogTarget } from './components/EntryDialog';
import { folderName, monthLabel } from './components/format';
import { GlanceView } from './components/GlanceView';
import { useMini, useNarrow } from './components/hooks';
import { LinesView } from './components/LinesView';
import { PocketsView } from './components/PocketsView';
import { ReceiptDialog, type ScanPrefill } from './components/ReceiptDialog';
import { ReviewView } from './components/ReviewView';
import { SettingsView } from './components/SettingsView';
import { Icon } from './components/ui';
import { openFolderInOS } from './data/host';
import { hostReceipts } from './data/receipts';
import { useBudget } from './data/useBudget';
import { useI18n } from './i18n';
import { addMonths, localDay, monthOf } from './model/dates';
import { monthSummary, type PlannedLine } from './model/ledger';
import { newId } from './model/records';
import type { Entry, Month, Recurring } from './model/types';

type Tab = 'dashboard' | 'pockets' | 'lines' | 'review' | 'settings';
const TABS: ReadonlyArray<{ id: Tab; icon: string; key: string }> = [
  { id: 'dashboard', icon: 'dashboard', key: 'nav.dashboard' },
  { id: 'pockets', icon: 'pockets', key: 'nav.pockets' },
  { id: 'lines', icon: 'lines', key: 'nav.lines' },
  { id: 'review', icon: 'review', key: 'nav.review' },
  { id: 'settings', icon: 'settings', key: 'nav.settings' },
];
const WITH_MONTH: ReadonlyArray<Tab> = ['dashboard', 'pockets', 'lines'];

/**
 * MnemoBudget (doc 177): what is spent, planned and left this month, in
 * pockets. A side rail (a bottom bar under 900 px, one figure under 560 × 420 px) opens the dashboard, the
 * pockets, the lines, « À vérifier » and the settings. The orb writes through
 * BudgetAgentActions; a person through the dialog. Every state has its
 * screen: booting, no folder, loading, error, ready.
 */
export default function App() {
  const { t, tc, lang } = useI18n();
  const budget = useBudget();
  const { status, settings, entries, recurring, unreadable, saveError, memoryError } = budget;
  const narrow = useNarrow();
  // The board zoomed out, or the window shrunk: one figure instead of the screens (doc 177 §13.7).
  const far = useFar();
  const mini = useMini();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [month, setMonth] = useState<Month>(monthOf(localDay()));
  const [pocketId, setPocketId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  // The receipts dialog (doc 177 §14), and the answer it waits for when a ticket needs the person's hand.
  const [receipts, setReceipts] = useState(false);
  const scanAsk = useRef<((saved: boolean) => void) | null>(null);
  const askForm = useCallback((prefill: ScanPrefill) => new Promise<boolean>((resolve) => {
    scanAsk.current = resolve;
    setDialog({ kind: 'new', status: 'paid', prefill });
  }), []);
  const closeReceipts = useCallback(() => setReceipts(false), []);
  const closeDialog = useCallback(() => {
    setDialog(null);
    // Closed without saving: the receipt is skipped, never lost (its photo stays in the folder).
    scanAsk.current?.(false);
    scanAsk.current = null;
  }, []);

  const today = localDay();
  const summary = useMemo(
    () => (settings ? monthSummary(settings, entries, recurring, month, today) : null),
    [settings, entries, recurring, month, today],
  );
  const reviewCount = summary ? summary.review.length + summary.reviewRecurring.length : 0;

  /** What an agent asks to see: a month, and a pocket in it. */
  const show = useCallback((target: { month: Month; pocketId?: string }) => {
    setMonth(target.month);
    setPocketId(target.pocketId ?? null);
    setTab(target.pocketId ? 'pockets' : 'dashboard');
    setDialog(null);
  }, []);

  const openPocket = (id: string | null) => {
    setPocketId(id);
    setTab('pockets');
  };

  /** A person's save: settings first (a new category before the line that names it), then the line, never under review. */
  const saveFromDialog = async (result: DialogResult) => {
    if (result.settings && !(await budget.saveSettings(result.settings))) return false;
    if (result.entry) {
      const entry = { ...result.entry };
      delete entry.review;
      if (!(await budget.saveEntry(entry))) return false;
    }
    if (result.recurring) {
      const rec = { ...result.recurring };
      delete rec.review;
      if (!(await budget.saveRecurring(rec))) return false;
    }
    // A receipt the person completed: the receipts dialog moves to the next one.
    scanAsk.current?.(true);
    scanAsk.current = null;
    return true;
  };

  /** « Payé » on a plan: a planned line turns paid today; a recurring occurrence gets its own paid line. */
  const markPaid = async (line: PlannedLine) => {
    const now = new Date().toISOString();
    if (line.entry) {
      const entry: Entry = { ...line.entry, status: 'paid', day: today, updatedAt: now };
      delete entry.wholeMonth;
      delete entry.review;
      await budget.saveEntry(entry);
      return;
    }
    const r = line.recurring!;
    await budget.saveEntry({
      id: newId('e'), status: 'paid', amountCents: r.amountCents, currency: r.currency, day: today, pocketId: r.pocketId, origin: 'recurring',
      recurringId: r.id, occurrence: line.day, createdAt: now, updatedAt: now,
      ...(r.categoryId ? { categoryId: r.categoryId } : {}),
      ...(r.label ? { label: r.label } : {}),
    });
  };

  const editTarget = (item: Entry | Recurring): DialogTarget => ('status' in item ? { kind: 'entry', entry: item } : { kind: 'recurring', recurring: item });
  const edit = (item: Entry | Recurring) => setDialog(editTarget(item));

  // Mounted on every screen: before a folder is chosen, the orb hears why it cannot write (doc 177 §11).
  const agent = <BudgetAgentActions budget={budget} view={{ show }} />;
  const ambient = <div className="b-ambient" aria-hidden="true"><div className="b-blob a" /><div className="b-blob b" /></div>;

  if (status.kind === 'booting' || status.kind === 'loading') {
    return (
      <>
        {agent}{ambient}
        <div className="b-center"><div><div className="b-spinner" /><p className="b-sub" role="status">{t('app.loading')}</p></div></div>
      </>
    );
  }

  if (status.kind === 'noFolder') {
    return (
      <div className="b-center">
        {agent}{ambient}
        <div className="glass b-hello">
          <div className="b-hello-mark">💶</div>
          <h1>{t('welcome.title')}</h1>
          <p>{t('welcome.body')}</p>
          <p className="b-sub">{t('welcome.example')}</p>
          {status.bridgeError && <p className="b-error" role="alert">{status.bridgeError}</p>}
          <div className="b-hello-step">
            <strong><span className="b-step-no">1</span>{t('welcome.stepFolder')}</strong>
            {budget.proposed && (
              <div className="b-proposed">
                <span className="b-sub">{t('welcome.proposed')}</span>
                <code className="b-folder-path" data-testid="proposed-folder">{budget.proposed}</code>
              </div>
            )}
          </div>
          <div className="b-hello-step">
            <strong><span className="b-step-no">2</span>{t('welcome.stepCurrency')}</strong>
            <CurrencyPicker value={budget.starterBase} onChange={budget.setStarterBase} limit={8} />
          </div>
          <div className="b-actions" style={{ justifyContent: 'center' }}>
            {budget.proposed ? (
              <>
                <button type="button" className="primary" onClick={() => void budget.acceptProposed()}><Icon name="check" size={16} /> {t('welcome.ok')}</button>
                <button type="button" onClick={budget.chooseFolder}><Icon name="folder" size={16} /> {t('welcome.other')}</button>
              </>
            ) : (
              <button type="button" className="primary" onClick={budget.chooseFolder}><Icon name="folder" size={16} /> {t('welcome.choose')}</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'error' || !settings || !summary) {
    const folder = status.kind === 'error' || status.kind === 'ready' ? status.folder : '';
    return (
      <div className="b-center">
        {agent}{ambient}
        <div className="glass b-hello" role="alert">
          <div className="b-hello-mark"><Icon name="warn" size={28} /></div>
          <h1>{t('error.title')}</h1>
          <p>{status.kind === 'error' && status.settingsUnreadable ? status.message : t('error.folder', { folder, reason: status.kind === 'error' ? status.message : '' })}</p>
          <div className="b-actions" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={budget.reload}>{t('error.retry')}</button>
            <button type="button" className="primary" onClick={budget.chooseFolder}>{t('error.otherFolder')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (far) {
    return <>{agent}{ambient}<GlanceView summary={summary} settings={settings} mode="far" /></>;
  }
  if (mini) {
    return (
      <>
        {agent}{ambient}
        <GlanceView summary={summary} settings={settings} mode="mini" onAdd={() => setDialog({ kind: 'new', status: 'paid' })} />
        {dialog && <EntryDialog target={dialog} settings={settings} onClose={() => setDialog(null)} onSave={saveFromDialog} />}
      </>
    );
  }

  const navButton = (item: typeof TABS[number], compact: boolean) => (
    <button key={item.id} type="button" className={compact ? 'icon-btn' : 'b-nav-btn'} aria-pressed={tab === item.id} aria-label={t(item.key)} title={t(item.key)}
      onClick={() => { setTab(item.id); if (item.id !== 'pockets') setPocketId(null); }}>
      <Icon name={item.icon} size={compact ? 20 : 18} />
      {!compact && <span>{t(item.key)}</span>}
      {item.id === 'review' && reviewCount > 0 && <span className="badge" data-testid="review-count">{reviewCount}</span>}
    </button>
  );
  const addButton = (fab: boolean) => (
    <button type="button" className={fab ? 'primary b-fab' : 'primary'} aria-label={t('action.add')} title={t('action.add')}
      onClick={() => setDialog({ kind: 'new', status: 'paid', ...(pocketId && tab === 'pockets' ? { pocketId } : {}) })}>
      <Icon name="plus" size={fab ? 24 : 16} />{!fab && ` ${t('action.add')}`}
    </button>
  );
  const current = TABS.find((x) => x.id === tab)!;

  return (
    <div className="b-app">
      {agent}{ambient}

      {!narrow && (
        <aside className="glass b-side">
          <div className="b-brand"><span className="b-brand-mark">💶</span>{t('app.title')}</div>
          {TABS.map((item) => navButton(item, false))}
          <div className="b-side-foot">
            <span className="b-sub" title={status.folder}><Icon name="folder" size={12} /> {folderName(status.folder)}</span>
            <span className="b-sub"><Icon name="mic" size={12} /> {t('app.sayIt')}</span>
          </div>
        </aside>
      )}

      <div className="b-body">
        <header className="b-top">
          <h1 className="b-view-title">
            {narrow && <span className="b-brand-mark" aria-hidden="true">💶</span>}
            {t(current.key)}
          </h1>
          {WITH_MONTH.includes(tab) && (
            <span className="glass b-month">
              <button type="button" className="icon-btn" aria-label={t('nav.prevMonth')} title={t('nav.prevMonth')} onClick={() => setMonth((m) => addMonths(m, -1))}><Icon name="prev" /></button>
              <button type="button" className="b-month-name" title={t('nav.thisMonth')} onClick={() => setMonth(monthOf(today))}>{monthLabel(month, lang)}</button>
              <button type="button" className="icon-btn" aria-label={t('nav.nextMonth')} title={t('nav.nextMonth')} onClick={() => setMonth((m) => addMonths(m, 1))}><Icon name="next" /></button>
            </span>
          )}
          {!narrow && <button type="button" onClick={() => setReceipts(true)} title={t('receipt.title')}><Icon name="receipt" size={16} /> {t('receipt.button')}</button>}
          {!narrow && addButton(false)}
        </header>

        <main className={`b-main${tab === 'dashboard' && !narrow ? ' fill' : ''}`} key={tab}>
          {saveError && (
            <div className="b-banner" role="alert">
              <span>{t('error.save', { reason: saveError })}</span>
              <button type="button" className="icon-btn" aria-label={t('action.close')} onClick={budget.clearSaveError}><Icon name="close" size={14} /></button>
            </div>
          )}
          {memoryError && <div className="b-banner warn" role="status"><span>{t('settings.memory')} : {memoryError}</span></div>}
          {unreadable.length > 0 && (
            <div className="b-banner warn" role="status">
              <span>{tc('error.unreadable', unreadable.length, { files: unreadable.slice(0, 5).join(', ') })}</span>
            </div>
          )}

          {tab === 'dashboard' && (
            <DashboardView summary={summary} settings={settings} entries={entries} recurring={recurring} month={month} today={today}
              onPocket={openPocket} onEdit={edit} onPaid={(line) => void markPaid(line)} onGo={(to) => { setTab(to); if (to !== 'pockets') setPocketId(null); }} />
          )}
          {tab === 'pockets' && (
            <PocketsView summary={summary} settings={settings} pocketId={pocketId} onPocket={setPocketId} onEdit={edit} onPaid={(line) => void markPaid(line)} onSettings={() => setTab('settings')} />
          )}
          {tab === 'lines' && <LinesView summary={summary} settings={settings} onEdit={edit} onPaid={(line) => void markPaid(line)} />}
          {tab === 'review' && (
            <ReviewView entries={summary.review} recurring={summary.reviewRecurring} settings={settings}
              onConfirm={(item) => void budget.confirm(item)}
              onConfirmAll={() => void (async () => {
                for (const item of [...summary.review, ...summary.reviewRecurring]) {
                  if (!(await budget.confirm(item))) break;
                }
              })()}
              onEdit={edit} />
          )}
          {tab === 'settings' && (
            <SettingsView settings={settings} folder={status.folder} onSave={budget.saveSettings} onChangeFolder={budget.chooseFolder}
              onOpenFolder={() => void openFolderInOS(status.folder).catch((err) => console.warn('[mnemo-budget] folder not opened:', err))} />
          )}
        </main>
      </div>

      {narrow && (
        <>
          <nav className="glass b-tabbar" aria-label={t('app.title')}>{TABS.map((item) => navButton(item, true))}</nav>
          <button type="button" className="glass b-fab second" aria-label={t('receipt.button')} title={t('receipt.title')} onClick={() => setReceipts(true)}><Icon name="receipt" size={22} /></button>
          {addButton(true)}
        </>
      )}

      {receipts && (
        <ReceiptDialog settings={settings} io={hostReceipts} today={today} onSaveScan={budget.saveEntry} onNeedsForm={askForm} onClose={closeReceipts} />
      )}

      {dialog && (
        <EntryDialog target={dialog} settings={settings} onClose={closeDialog} onSave={saveFromDialog}
          {...(dialog.kind === 'entry' ? { onDelete: () => budget.removeRecord('entries', dialog.entry.id) } : {})}
          {...(dialog.kind === 'recurring' ? { onDelete: () => budget.removeRecord('recurring', dialog.recurring.id) } : {})} />
      )}
    </div>
  );
}
