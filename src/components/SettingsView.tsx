import { useState } from 'react';
import { useI18n, type LangMode } from '../i18n';
import { currencyName, formatRate, knownCurrencies, linkToBase, rebaseSettings } from '../model/currencies';
import { localDay } from '../model/dates';
import { formatMoney, formatPlain, parseAmount, parseRate } from '../model/money';
import { newId } from '../model/records';
import type { BudgetSettings, Category, Currency, Pocket, Rate } from '../model/types';
import { ConfirmDialog } from './ConfirmDialog';
import { CurrencyPicker, CurrencySymbol, CurrencyTile } from './CurrencyPicker';
import { dayLabel, folderName } from './format';
import { CardHead, Icon, Tag } from './ui';

interface Props {
  settings: BudgetSettings;
  folder: string;
  onSave: (next: BudgetSettings) => Promise<boolean>;
  onChangeFolder: () => void;
  onOpenFolder: () => void;
}

/**
 * The currencies (the main one, the others with their rates), the pockets
 * and their categories with a monthly cap, the folder, the memory switch,
 * the language. Every change is written to settings.json at once.
 */
export function SettingsView({ settings, folder, onSave, onChangeFolder, onOpenFolder }: Props) {
  const { t, lang, langMode, setLangMode } = useI18n();
  const base = settings.baseCurrency;
  const [newPocket, setNewPocket] = useState('');
  const [changing, setChanging] = useState(false);
  const [rebase, setRebase] = useState<{ code: Currency; typed: string; asBase: boolean; link: { value: number; day: string } | null; error: string | null } | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'pocket'; pocket: Pocket } | { kind: 'category'; pocket: Pocket; category: Category } | null>(null);
  const others = knownCurrencies(settings).filter((c) => c !== base);

  const withPocket = (pocketId: string, change: (p: Pocket) => Pocket) =>
    onSave({ ...settings, pockets: settings.pockets.map((p) => (p.id === pocketId ? change(p) : p)) });

  const setCap = (pocket: Pocket, category: Category, raw: string) => {
    const trimmed = raw.trim();
    const cents = trimmed ? parseAmount(trimmed) : null;
    if (trimmed && cents === null) return;
    void withPocket(pocket.id, (p) => ({
      ...p,
      categories: p.categories.map((c) => {
        if (c.id !== category.id) return c;
        const next = { ...c };
        if (cents === null) delete next.capCents;
        else next.capCents = cents;
        return next;
      }),
    }));
  };

  /** A rate typed for `code`, in the direction shown; saved base-per-unit with today's day. */
  const setRate = (code: Currency, raw: string, asBase: boolean) => {
    const typed = raw.trim() ? parseRate(raw) : null;
    const rates = { ...settings.rates };
    if (typed === null) {
      if (!raw.trim()) delete rates[code];
      else return;
    } else {
      const rate: Rate = { value: asBase ? 1 / typed : typed, day: localDay(), ...(asBase ? { typedAsBase: true as const } : {}) };
      const current = settings.rates[code];
      if (current && current.value === rate.value && !!current.typedAsBase === asBase) return;
      rates[code] = rate;
    }
    void onSave({ ...settings, rates });
  };

  const addCurrency = (code: Currency) => {
    if (code === base || (settings.currencies ?? []).includes(code)) return;
    void onSave({ ...settings, currencies: [...(settings.currencies ?? []), code] });
  };

  const removeCurrency = (code: Currency) => {
    const rates = { ...settings.rates };
    delete rates[code];
    void onSave({ ...settings, rates, currencies: (settings.currencies ?? []).filter((c) => c !== code) });
  };

  /** « Passer en MAD »: the rate between the two bases is asked, or the one already held is offered. */
  const startRebase = (code: Currency) => {
    const link = linkToBase(settings, code);
    setRebase({ code, typed: link ? formatRate(link.value, lang) : '', asBase: true, link, error: null });
  };

  const confirmRebase = () => {
    if (!rebase) return;
    const typed = parseRate(rebase.typed);
    if (typed === null) return setRebase({ ...rebase, error: t('entry.badAmount') });
    // The direction shown: « 1 EUR = x MAD » (asBase) or « 1 MAD = x EUR ».
    const value = rebase.asBase ? typed : 1 / typed;
    const unchanged = rebase.link && Math.abs(value - rebase.link.value) < 1e-9;
    const day = unchanged && rebase.link ? rebase.link.day : localDay();
    let next;
    try {
      next = rebaseSettings(settings, rebase.code, { value, day });
    } catch (err) {
      // A rate too small to invert (1e-320 → Infinity): refused by the model, said here.
      console.warn('[mnemo-budget] rate refused:', err);
      return setRebase({ ...rebase, error: t('entry.badAmount') });
    }
    void onSave(next).then((ok) => {
      if (ok) { setRebase(null); setChanging(false); }
    });
  };

  const confirmRemove = () => {
    if (!removing) return;
    const done = removing.kind === 'pocket'
      ? onSave({ ...settings, pockets: settings.pockets.filter((p) => p.id !== removing.pocket.id) })
      : withPocket(removing.pocket.id, (p) => ({ ...p, categories: p.categories.filter((c) => c.id !== removing.category.id) }));
    void done.then((ok) => { if (ok) setRemoving(null); });
  };

  return (
    <div className="b-settings">
      <section className="glass b-card full">
        <CardHead icon="coins" title={t('settings.currencies')} />
        <div className="b-field">
          <span>{t('settings.base')}</span>
          <div className="b-row">
            <CurrencyTile code={base} chosen />
            <button type="button" className="small" aria-pressed={changing} onClick={() => setChanging((c) => !c)}><Icon name="swap" size={14} /> {t('settings.changeBase')}</button>
          </div>
          {changing && (
            <div className="b-hello-step">
              <span className="b-sub">{t('settings.changeBaseHint')}</span>
              <CurrencyPicker value={null} onChange={startRebase} exclude={[base]} compact limit={10} />
            </div>
          )}
        </div>

        <div className="b-field">
          <span>{t('settings.otherCurrencies')}</span>
          {others.length === 0 && <span className="b-sub">{t('settings.noOtherCurrency')}</span>}
          <div className="b-stack" style={{ gap: 4 }}>
            {others.map((code) => {
              const rate = settings.rates[code];
              const asBase = rate?.typedAsBase === true;
              const shown = rate ? formatRate(asBase ? 1 / rate.value : rate.value, lang) : '';
              return (
                <div className="b-cur-row" key={code}>
                  <CurrencySymbol code={code} />
                  <span className="b-cur-main">
                    <strong>{code} <span className="b-sub">{currencyName(code, lang)}</span></strong>
                    <span className="b-rate-line">
                      <span className="b-sub">1 {asBase ? base : code} =</span>
                      <input key={`${code}-${asBase}-${rate?.value ?? ''}`} defaultValue={shown} inputMode="decimal" placeholder={t('settings.rateHint')} aria-label={t('settings.rateFor', { currency: code })}
                        onBlur={(e) => setRate(code, e.target.value, asBase)} />
                      <span className="b-sub">{asBase ? code : base}</span>
                      <button type="button" className="icon-btn round" aria-label={t('settings.swapRate')} title={t('settings.swapRate')}
                        onClick={() => { if (rate) void onSave({ ...settings, rates: { ...settings.rates, [code]: asBase ? { value: rate.value, day: rate.day } : { ...rate, typedAsBase: true } } }); }}
                        disabled={!rate}><Icon name="swap" size={14} /></button>
                      {rate ? <span className="b-sub">{t('settings.rateDay', { day: dayLabel(rate.day, lang) })}</span> : <Tag tone="warn">{t('dash.noRate')}</Tag>}
                    </span>
                  </span>
                  <button type="button" className="icon-btn round" aria-label={t('settings.removeCurrency', { currency: code })} title={t('settings.removeCurrency', { currency: code })} onClick={() => removeCurrency(code)}><Icon name="close" size={14} /></button>
                </div>
              );
            })}
          </div>
          <span className="b-sub">{t('settings.ratesBody')}</span>
          <CurrencyPicker value={null} onChange={addCurrency} exclude={[base, ...others]} compact limit={8} />
        </div>
      </section>

      <section className="glass b-card full">
        <CardHead icon="pockets" title={t('settings.pockets')} />
        <div className="g-grid">
          {settings.pockets.map((pocket) => (
            <div className="b-set-pocket" key={pocket.id}>
              <div className="b-set-pocket-head">
                <input className="b-set-icon" defaultValue={pocket.icon ?? ''} maxLength={4} aria-label={t('settings.icon')} title={t('settings.icon')}
                  onBlur={(e) => { const icon = e.target.value.trim(); if (icon !== (pocket.icon ?? '')) void withPocket(pocket.id, (p) => { const n = { ...p }; if (icon) n.icon = icon; else delete n.icon; return n; }); }} />
                <input className="b-set-name" defaultValue={pocket.name} maxLength={80} aria-label={t('settings.pocketName')}
                  onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== pocket.name) void withPocket(pocket.id, (p) => ({ ...p, name })); else e.target.value = pocket.name; }} />
                <button type="button" className="icon-btn round danger" aria-label={t('settings.removePocket', { name: pocket.name })} title={t('settings.removePocket', { name: pocket.name })} onClick={() => setRemoving({ kind: 'pocket', pocket })}><Icon name="trash" size={14} /></button>
              </div>
              {pocket.categories.map((category) => (
                <div className="b-set-cat" key={category.id}>
                  <input key={`name-${category.name}`} defaultValue={category.name} maxLength={80} aria-label={t('entry.category')}
                    onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== category.name) void withPocket(pocket.id, (p) => ({ ...p, categories: p.categories.map((c) => (c.id === category.id ? { ...c, name } : c)) })); else e.target.value = category.name; }} />
                  <input key={`cap-${category.capCents ?? ''}`} defaultValue={category.capCents === undefined ? '' : formatPlain(category.capCents, lang)} inputMode="decimal"
                    placeholder={t('settings.capHint')} aria-label={t('settings.cap')} title={`${t('settings.cap')} (${base})`}
                    onBlur={(e) => setCap(pocket, category, e.target.value)} />
                  <button type="button" className="icon-btn round" aria-label={t('settings.removeCategory', { name: category.name })} title={t('settings.removeCategory', { name: category.name })} onClick={() => setRemoving({ kind: 'category', pocket, category })}><Icon name="close" size={14} /></button>
                </div>
              ))}
              <form className="b-row" onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem('cat') as HTMLInputElement);
                const name = input.value.trim();
                if (!name) return;
                void withPocket(pocket.id, (p) => ({ ...p, categories: [...p.categories, { id: newId('c'), name: name.slice(0, 80) }] })).then((ok) => { if (ok) input.value = ''; });
              }}>
                <input name="cat" placeholder={t('settings.categoryName')} maxLength={80} className="b-grow" style={{ padding: '7px 10px' }} />
                <button type="submit" className="small"><Icon name="plus" size={14} /> {t('settings.addCategory')}</button>
              </form>
            </div>
          ))}
        </div>
        <form className="b-row" onSubmit={(e) => {
          e.preventDefault();
          const name = newPocket.trim();
          if (!name) return;
          void onSave({ ...settings, pockets: [...settings.pockets, { id: newId('p'), name: name.slice(0, 80), categories: [] }] }).then((ok) => { if (ok) setNewPocket(''); });
        }}>
          <input value={newPocket} onChange={(e) => setNewPocket(e.target.value)} placeholder={t('settings.pocketName')} maxLength={80} style={{ flex: '1 1 200px' }} />
          <button type="submit" className="primary"><Icon name="plus" size={14} /> {t('settings.addPocket')}</button>
        </form>
      </section>

      <section className="glass b-card">
        <CardHead icon="folder" title={t('settings.folder')} />
        <strong>{folderName(folder)}</strong>
        <span className="b-folder-path">{folder}</span>
        <div className="b-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="small" onClick={onOpenFolder}><Icon name="external" size={14} /> {t('settings.openFolder')}</button>
          <button type="button" className="small" onClick={onChangeFolder}><Icon name="folder" size={14} /> {t('settings.changeFolder')}</button>
        </div>
      </section>

      <section className="glass b-card">
        <CardHead icon="memory" title={t('settings.memory')} />
        <p className="b-sub" style={{ margin: 0 }}>{t('settings.memoryBody')}</p>
        <label className="b-switch">
          <input type="checkbox" checked={settings.memory} onChange={(e) => void onSave({ ...settings, memory: e.target.checked })} />
          <span>{t('settings.memoryOn')}</span>
        </label>
      </section>

      <section className="glass b-card">
        <CardHead icon="language" title={t('lang.label')} />
        <div className="b-tiles">
          {([['auto', t('lang.auto')], ['fr', 'Français'], ['en', 'English'], ['es', 'Español']] as Array<[LangMode, string]>).map(([mode, name]) => (
            <button key={mode} type="button" className={`chip-tile glass${langMode === mode ? ' chosen' : ''}`} aria-pressed={langMode === mode} onClick={() => setLangMode(mode)}>{name}</button>
          ))}
        </div>
      </section>

      {rebase && (
        <ConfirmDialog title={t('settings.rebaseTitle', { currency: rebase.code })} confirmLabel={t('settings.rebaseConfirm', { currency: rebase.code })} onConfirm={confirmRebase} onClose={() => setRebase(null)}>
          <p style={{ margin: 0 }}>{t('settings.rebaseBody', { from: base, to: rebase.code })}</p>
          <div className="b-field">
            <span>{t('settings.rebaseRate')}</span>
            <span className="b-rate-line">
              <span>1 {rebase.asBase ? base : rebase.code} =</span>
              <input value={rebase.typed} onChange={(e) => setRebase({ ...rebase, typed: e.target.value, error: null })} inputMode="decimal" aria-label={t('settings.rebaseRate')} autoFocus />
              <span>{rebase.asBase ? rebase.code : base}</span>
              <button type="button" className="icon-btn round" aria-label={t('settings.swapRate')} title={t('settings.swapRate')}
                onClick={() => { const typed = parseRate(rebase.typed); setRebase({ ...rebase, asBase: !rebase.asBase, typed: typed ? formatRate(1 / typed, lang) : rebase.typed }); }}><Icon name="swap" size={14} /></button>
            </span>
            {rebase.link && <span className="b-sub">{t('settings.rebaseKnown', { day: dayLabel(rebase.link.day, lang) })}</span>}
            {rebase.error && <span className="b-error" role="alert">{rebase.error}</span>}
          </div>
          <ul className="b-sub" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('settings.rebaseCaps', { example: formatMoney(12000, base, lang) })}</li>
            <li>{t('settings.rebaseRates')}</li>
          </ul>
        </ConfirmDialog>
      )}

      {removing && (
        <ConfirmDialog title={removing.kind === 'pocket' ? t('settings.removePocket', { name: removing.pocket.name }) : t('settings.removeCategory', { name: removing.category.name })}
          confirmLabel={t('settings.remove')} danger onConfirm={confirmRemove} onClose={() => setRemoving(null)}>
          <p style={{ margin: 0 }}>{removing.kind === 'pocket' ? t('settings.removePocketConfirm', { name: removing.pocket.name }) : t('settings.removeCategoryConfirm', { name: removing.category.name })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
