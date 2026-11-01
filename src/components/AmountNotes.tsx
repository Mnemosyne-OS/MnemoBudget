import { useI18n } from '../i18n';
import { hasUnconverted, type Amounts } from '../model/ledger';
import { formatRate } from '../model/currencies';
import type { BudgetSettings } from '../model/types';
import { dayLabel } from './format';

/**
 * Under a figure: what it left out (« + 2 lignes en USD sans taux, hors
 * total ») and the rate each converted currency went through, with the day
 * the person read it (doc 177 §3 rule 4).
 */
export function AmountNotes({ amounts, settings }: { amounts: Amounts; settings: BudgetSettings }) {
  const { t, tc, lang } = useI18n();
  return (
    <>
      {amounts.converted.map((currency) => {
        const rate = settings.rates[currency];
        if (!rate) return null;
        return (
          <span key={`rate-${currency}`} className="b-figure-note">
            {t('month.rateUsed', { currency, value: formatRate(rate.value, lang), base: settings.baseCurrency, day: dayLabel(rate.day, lang) })}
          </span>
        );
      })}
      {hasUnconverted(amounts) && Object.entries(amounts.unconverted).map(([currency, u]) => (
        <span key={currency} className="b-figure-note">{tc('month.unconverted', u.count, { currency })}</span>
      ))}
    </>
  );
}
