import { describe, expect, it } from 'vitest';
import { COMMON_CURRENCIES, currencyName, currencySymbol, formatRate, knownCurrencies, linkToBase, rebaseSettings } from './currencies';
import { convert } from './money';
import type { BudgetSettings } from './types';

const settings: BudgetSettings = {
  version: 1,
  baseCurrency: 'EUR',
  memory: false,
  rates: { MAD: { value: 0.1, day: '2026-10-20' }, USD: { value: 0.9, day: '2026-10-01', typedAsBase: true } },
  currencies: ['MAD', 'GBP'],
  pockets: [
    { id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien', capCents: 12000 }, { id: 'food', name: 'Courses' }] },
  ],
};

describe('a change of main currency (doc 177 §3 rule 4: no rate invented)', () => {
  it('EUR → MAD with « 1 EUR = 10 MAD »: the old base gets that rate, the others are carried across, GBP still has none', () => {
    const next = rebaseSettings(settings, 'MAD', { value: 10, day: '2026-10-26' });
    expect(next.baseCurrency).toBe('MAD');
    expect(next.rates.EUR).toEqual({ value: 10, day: '2026-10-26' });
    // 1 USD = 0.9 EUR = 9 MAD, dated the OLDER of the two days (a derived figure is as fresh as its oldest source).
    expect(next.rates.USD).toEqual({ value: 9, day: '2026-10-01' });
    expect(next.rates.MAD).toBeUndefined();
    expect(next.rates.GBP).toBeUndefined();
    expect(convert(1000, 'GBP', 'MAD', next.rates)).toBeNull();
  });

  it('the caps are the same money: 120 € becomes 1 200 MAD, an unset cap stays unset', () => {
    const next = rebaseSettings(settings, 'MAD', { value: 10, day: '2026-10-26' });
    const home = next.pockets[0]!;
    expect(home.categories[0]!.capCents).toBe(120000);
    expect(home.categories[1]!.capCents).toBeUndefined();
  });

  it('🎭 a cap that falls under a cent is dropped, never made up to one', () => {
    const tiny: BudgetSettings = { ...settings, pockets: [{ id: 'p', name: 'P', categories: [{ id: 'c', name: 'C', capCents: 1 }] }] };
    const next = rebaseSettings(tiny, 'MAD', { value: 0.3, day: '2026-10-26' });
    expect(next.pockets[0]!.categories[0]!.capCents).toBeUndefined();
  });

  it('the old base joins the used currencies, the new base leaves them', () => {
    const next = rebaseSettings(settings, 'MAD', { value: 10, day: '2026-10-26' });
    expect(next.currencies).toEqual(['EUR', 'GBP']);
  });

  it('🎭 the typed direction of a carried rate is dropped: nobody typed the derived one', () => {
    const next = rebaseSettings(settings, 'MAD', { value: 10, day: '2026-10-26' });
    expect(next.rates.USD!.typedAsBase).toBeUndefined();
  });

  it('a change to the same currency changes nothing; a rate of 0 is refused', () => {
    expect(rebaseSettings(settings, 'EUR', { value: 1, day: '2026-10-26' })).toBe(settings);
    expect(() => rebaseSettings(settings, 'MAD', { value: 0, day: '2026-10-26' })).toThrow('BAD_RATE');
  });

  it('linkToBase finds the rate already held, read the way a change of base needs it', () => {
    expect(linkToBase(settings, 'MAD')).toEqual({ value: 10, day: '2026-10-20' });
    expect(linkToBase(settings, 'GBP')).toBeNull();
  });
});

describe('what a person chooses from', () => {
  it('known currencies: the base first, then the used ones, the rated ones, and a line\'s own, each once', () => {
    expect(knownCurrencies(settings, 'JPY', 'MAD', undefined)).toEqual(['EUR', 'MAD', 'GBP', 'USD', 'JPY']);
  });

  it('symbols and names come from Intl, and an unknown code still prints', () => {
    expect(currencySymbol('EUR', 'fr')).toBe('€');
    expect(currencySymbol('USD', 'en')).toBe('$');
    expect(currencyName('MAD', 'fr').toLowerCase()).toContain('dirham');
    expect(currencyName('ZZZ', 'fr')).toBe('ZZZ');
    expect(COMMON_CURRENCIES).toContain('MAD');
  });

  it('a rate is written with six significant digits, never a float\'s tail', () => {
    expect(formatRate(1 / 0.0925, 'en')).toBe('10.8108');
    expect(formatRate(0.092, 'fr')).toBe('0,092');
  });
});
