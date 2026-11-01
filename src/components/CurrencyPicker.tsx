import { useState } from 'react';
import { useI18n } from '../i18n';
import { COMMON_CURRENCIES, currencyName, currencySymbol } from '../model/currencies';
import { normalizeCurrency } from '../model/money';
import type { Currency } from '../model/types';
import { Icon } from './ui';

/** The sign of a currency in a box; a code Intl has no sign for is drawn smaller so it fits. */
export function CurrencySymbol({ code }: { code: Currency }) {
  const { lang } = useI18n();
  const symbol = currencySymbol(code, lang);
  return <span className={`b-cur-symbol${symbol.length > 2 ? ' long' : ''}`} aria-hidden="true">{symbol}</span>;
}

/** One currency as a tile: its symbol, its code, its name in the person's language. */
export function CurrencyTile({ code, chosen, compact, onPick, disabled }: { code: Currency; chosen?: boolean; compact?: boolean; onPick?: () => void; disabled?: boolean }) {
  const { lang } = useI18n();
  return (
    <button type="button" className={`chip-tile glass b-cur-tile${compact ? ' compact' : ''}${chosen ? ' chosen' : ''}`} aria-pressed={chosen} onClick={onPick} disabled={disabled} title={currencyName(code, lang)}>
      <CurrencySymbol code={code} />
      <strong>{code}</strong>
      {!compact && <span className="b-sub">{currencyName(code, lang)}</span>}
    </button>
  );
}

interface PickerProps {
  /** The codes to offer first; the common ones when absent. */
  codes?: readonly Currency[];
  value: Currency | null;
  onChange: (code: Currency) => void;
  /** Codes not offered (the base, the ones already used). */
  exclude?: readonly Currency[];
  compact?: boolean;
  /** How many tiles before « Autre » (the rest is typed). */
  limit?: number;
  /** Open on the typed code at once (the person already asked for « another » currency). */
  startTyping?: boolean;
}

/**
 * Tiles for the currencies a person most likely means, and « Autre » for any
 * ISO code typed (« AED »). A code nobody knows is still a code the person
 * chose (money.normalizeCurrency).
 */
export function CurrencyPicker({ codes = COMMON_CURRENCIES, value, onChange, exclude = [], compact, limit = 8, startTyping }: PickerProps) {
  const { t } = useI18n();
  const offered = [...new Set([...(value ? [value] : []), ...codes])].filter((c) => !exclude.includes(c) || c === value).slice(0, limit);
  const [other, setOther] = useState(startTyping === true || (value !== null && !offered.includes(value)));
  const [typed, setTyped] = useState(!startTyping && other && value ? value : '');
  const [error, setError] = useState<string | null>(null);
  const accept = (raw: string) => {
    setTyped(raw.toUpperCase());
    const code = normalizeCurrency(raw);
    if (code) { setError(null); onChange(code); } else if (raw.trim().length >= 3) setError(t('entry.badCurrency'));
  };
  return (
    <div className="b-stack" style={{ gap: 8 }}>
      <div className="b-cur-tiles">
        {offered.map((code) => <CurrencyTile key={code} code={code} compact={compact} chosen={!other && value === code} onPick={() => { setOther(false); setError(null); onChange(code); }} />)}
        <button type="button" className={`chip-tile glass b-cur-tile${compact ? ' compact' : ''}${other ? ' chosen' : ''}`} aria-pressed={other} onClick={() => setOther(true)}>
          <span className="b-cur-symbol" aria-hidden="true"><Icon name="plus" size={14} /></span>
          <strong>{t('currency.other')}</strong>
          {!compact && <span className="b-sub">{t('currency.otherHint')}</span>}
        </button>
      </div>
      {other && (
        <div className="b-row">
          <input value={typed} onChange={(e) => accept(e.target.value)} maxLength={3} placeholder="AED" aria-label={t('currency.code')} style={{ width: 110, textTransform: 'uppercase' }} autoFocus />
          {error && <span className="b-error" role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}
