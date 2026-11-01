/**
 * DEV ONLY — MnemoBudget's screens on a sample budget, without a host, so a
 * layout can be LOOKED at (overlaps, clipped labels, phone width) before a
 * person opens it. Loaded by preview.html, which the build does not include.
 * `?tab=dashboard|pockets|pocket|lines|review|settings|dialog|far|mini` picks the
 * screen; `?lang=` the language. The shell (rail, header) is the real one's
 * markup, so what is measured here is what the app draws.
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import { translate } from '../i18n';
import { DashboardView } from '../components/DashboardView';
import { GlanceView } from '../components/GlanceView';
import { EntryDialog } from '../components/EntryDialog';
import { LinesView } from '../components/LinesView';
import { PocketsView } from '../components/PocketsView';
import { ReviewView } from '../components/ReviewView';
import { SettingsView } from '../components/SettingsView';
import { useNarrow } from '../components/hooks';
import { Icon } from '../components/ui';
import { monthLabel } from '../components/format';
import { addMonths, localDay, monthOf } from '../model/dates';
import { monthSummary } from '../model/ledger';
import { ruleFor } from '../model/recurrence';
import type { BudgetSettings, Entry, Recurring } from '../model/types';

const today = localDay();
const month = monthOf(today);
const T = new Date().toISOString();
const settings: BudgetSettings = {
  version: 1, baseCurrency: 'EUR', memory: true, rates: { MAD: { value: 0.092, day: today }, USD: { value: 0.86, day: today, typedAsBase: true } }, currencies: ['MAD', 'USD', 'GBP'],
  pockets: [
    { id: 'home', name: translate('starter.home'), icon: '🏠', categories: [{ id: 'dog', name: translate('starter.dog'), capCents: 12000 }, { id: 'food', name: translate('starter.groceries'), capCents: 50000 }, { id: 'clean', name: translate('starter.cleaner') }] },
    { id: 'resto', name: 'Restaurant', icon: '🍽️', categories: [{ id: 'sup', name: translate('starter.suppliers'), capCents: 300000 }, { id: 'rentR', name: translate('starter.rent') }] },
    { id: 'shop', name: 'Pyjamas', icon: '🛍️', categories: [{ id: 'stock', name: 'Stock' }, { id: 'rentS', name: translate('starter.rent') }] },
    { id: 'kids', name: translate('starter.children'), icon: '👨‍👧', categories: [{ id: 'school', name: translate('starter.school'), capCents: 40000 }] },
  ],
};
const day = (d: number, m = month) => `${m}-${String(d).padStart(2, '0')}`;
let n = 0;
const line = (amount: number, d: number, pocketId: string, categoryId: string, label?: string, extra: Partial<Entry> = {}, m = month): Entry => ({
  id: `e${++n}`, status: 'paid', amountCents: amount, currency: 'EUR', day: day(d, m), pocketId, categoryId, origin: 'typed', createdAt: T, updatedAt: T, ...(label ? { label } : {}), ...extra,
});
const prev = addMonths(month, -1);
const prev2 = addMonths(month, -2);
const entries: Entry[] = [
  line(8000, 3, 'home', 'dog', 'Croquettes'),
  line(4560, 5, 'home', 'food', 'Courses Carrefour'),
  line(6000, 7, 'home', 'clean'),
  line(186040, 8, 'resto', 'sup', 'Métro'),
  line(42000, 10, 'shop', 'stock', 'Pyjamas hiver'),
  line(200000, 12, 'kids', 'school', 'Cantine', { currency: 'MAD' }),
  line(9500, 14, 'home', 'dog', 'Vétérinaire', { origin: 'agent', review: true }),
  line(3000, 20, 'kids', 'school', 'Fournitures', { currency: 'GBP' }),
  line(12000, 16, 'resto', 'sup', 'Poissonnier', { currency: 'USD' }),
  { ...line(30000, 1, 'kids', 'school', 'Noël'), status: 'planned', day: `${month}-28` },
  line(7000, 4, 'home', 'dog', 'Croquettes', {}, prev),
  line(31000, 9, 'home', 'food', 'Courses', {}, prev),
  line(150000, 12, 'resto', 'sup', 'Métro', {}, prev),
  line(9000, 2, 'home', 'dog', 'Croquettes', {}, prev2),
  line(210000, 11, 'resto', 'sup', 'Métro', {}, prev2),
];
const recurring: Recurring[] = [
  { id: 'r1', amountCents: 120000, currency: 'EUR', pocketId: 'shop', categoryId: 'rentS', label: 'Loyer magasin', rrule: ruleFor('monthly', day(5)), start: day(5, prev2), origin: 'agent', review: true, createdAt: T, updatedAt: T },
  { id: 'r2', amountCents: 6000, currency: 'EUR', pocketId: 'home', categoryId: 'clean', label: 'Femme de ménage', rrule: ruleFor('weekly', day(6)), start: day(6, prev), origin: 'typed', createdAt: T, updatedAt: T },
];
const summary = monthSummary(settings, entries, recurring, month, today);
const noop = () => {};
const TABS = ['dashboard', 'pockets', 'lines', 'review', 'settings'] as const;

function Preview() {
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(params.get('tab') ?? 'dashboard');
  const narrow = useNarrow();
  const [pocketId, setPocketId] = useState<string | null>(tab === 'pocket' ? 'home' : null);
  // `?tab=far` and `?tab=mini`: the glance, the whole window (resize the browser to judge the mini one).
  if (tab === 'far' || tab === 'mini') {
    return (
      <>
        <div className="b-ambient" aria-hidden="true"><div className="b-blob a" /><div className="b-blob b" /></div>
        <GlanceView summary={summary} settings={settings} mode={tab} onAdd={noop} />
      </>
    );
  }
  const view = tab === 'pocket' ? 'pockets' : tab === 'dialog' ? 'dashboard' : tab;
  const nav = (compact: boolean) => TABS.map((id) => (
    <button key={id} type="button" className={compact ? 'icon-btn' : 'b-nav-btn'} aria-pressed={view === id} aria-label={translate(`nav.${id}`)} title={translate(`nav.${id}`)} onClick={() => { setTab(id); setPocketId(null); }}>
      <Icon name={id} size={compact ? 20 : 18} />{!compact && <span>{translate(`nav.${id}`)}</span>}
      {id === 'review' && <span className="badge">{summary.review.length + summary.reviewRecurring.length}</span>}
    </button>
  ));
  return (
    <div className="b-app">
      <div className="b-ambient" aria-hidden="true"><div className="b-blob a" /><div className="b-blob b" /></div>
      {!narrow && (
        <aside className="glass b-side">
          <div className="b-brand"><span className="b-brand-mark">💶</span>{translate('app.title')}</div>
          {nav(false)}
        </aside>
      )}
      <div className="b-body">
        <header className="b-top">
          <h1 className="b-view-title">{translate(`nav.${view}`)}</h1>
          <span className="glass b-month">
            <button type="button" className="icon-btn" aria-label={translate('nav.prevMonth')}><Icon name="prev" /></button>
            <button type="button" className="b-month-name">{monthLabel(month, 'fr')}</button>
            <button type="button" className="icon-btn" aria-label={translate('nav.nextMonth')}><Icon name="next" /></button>
          </span>
          {!narrow && <button type="button" className="primary" onClick={() => setTab('dialog')}><Icon name="plus" size={16} /> {translate('action.add')}</button>}
        </header>
        <main className={`b-main${view === 'dashboard' && !narrow ? ' fill' : ''}`} key={view}>
          {view === 'dashboard' && <DashboardView summary={summary} settings={settings} entries={entries} recurring={recurring} month={month} today={today} onPocket={(id) => { setPocketId(id); setTab('pockets'); }} onEdit={noop} onPaid={noop} onGo={(to) => setTab(to)} />}
          {view === 'pockets' && <PocketsView summary={summary} settings={settings} pocketId={pocketId} onPocket={setPocketId} onEdit={noop} onPaid={noop} onSettings={() => setTab('settings')} />}
          {view === 'lines' && <LinesView summary={summary} settings={settings} onEdit={noop} onPaid={noop} />}
          {view === 'review' && <ReviewView entries={summary.review} recurring={summary.reviewRecurring} settings={settings} onConfirm={noop} onConfirmAll={noop} onEdit={noop} />}
          {view === 'settings' && <SettingsView settings={settings} folder="C:\\Users\\associe\\Documents\\Mnemosyne Apps\\MnemoBudget" onSave={async () => true} onChangeFolder={noop} onOpenFolder={noop} />}
        </main>
      </div>
      {narrow && (
        <>
          <nav className="glass b-tabbar">{nav(true)}</nav>
          <button type="button" className="primary b-fab" aria-label={translate('action.add')} onClick={() => setTab('dialog')}><Icon name="plus" size={24} /></button>
        </>
      )}
      {tab === 'dialog' && <EntryDialog target={{ kind: 'new', status: 'paid' }} settings={settings} onSave={async () => true} onClose={() => setTab('dashboard')} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
