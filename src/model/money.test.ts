import { describe, expect, it } from 'vitest';
import { centsFromNumber, convert, formatMoney, normalizeCurrency, parseAmount } from './money';

describe('parseAmount', () => {
  it.each([
    ['80', 8000],
    ['80,50', 8050],
    ['80.5', 8050],
    ['1 200', 120000],
    ['1.200', 120000],
    ['1.200,50', 120050],
    ['1,200.50', 120050],
    ['0,99', 99],
  ])('« %s » → %i', (raw, cents) => {
    expect(parseAmount(raw)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '0', '12,345,6', '1e5', '99999999999'])('« %s » is refused', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it('adds without float drift', () => {
    expect((parseAmount('80,10') ?? 0) + (parseAmount('0,20') ?? 0)).toBe(8030);
  });
});

describe('centsFromNumber', () => {
  it('rounds to the cent and refuses zero, negatives and non-numbers', () => {
    expect(centsFromNumber(80.1)).toBe(8010);
    expect(centsFromNumber(0)).toBeNull();
    expect(centsFromNumber(-3)).toBeNull();
    expect(centsFromNumber('80')).toBeNull();
    expect(centsFromNumber(Number.NaN)).toBeNull();
  });
});

describe('normalizeCurrency', () => {
  it.each([
    ['€', 'EUR'], ['euros', 'EUR'], ['Euro', 'EUR'], ['balles', 'EUR'],
    ['dirhams', 'MAD'], ['MAD', 'MAD'], ['DH', 'MAD'], ['dhs', 'MAD'], ['dollars', 'USD'], ['livres', 'GBP'],
    ['franc CFA', 'XOF'], ['AED', 'AED'],
  ])('« %s » → %s', (raw, code) => {
    expect(normalizeCurrency(raw)).toBe(code);
  });

  it('a word that names no currency is null, never a guess', () => {
    expect(normalizeCurrency('croquettes')).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency(42)).toBeNull();
  });
});

describe('convert', () => {
  const rates = { MAD: { value: 0.092, day: '2026-10-20' } };
  it('the base currency is itself', () => {
    expect(convert(8000, 'EUR', 'EUR', {})).toBe(8000);
  });
  it('a currency with a rate converts with it', () => {
    expect(convert(100000, 'MAD', 'EUR', rates)).toBe(9200);
  });
  it('🚨 a currency without a rate is null, never parity', () => {
    expect(convert(100000, 'USD', 'EUR', rates)).toBeNull();
    expect(convert(100, 'MAD', 'EUR', { MAD: { value: 0, day: '2026-10-20' } })).toBeNull();
  });
});

describe('formatMoney', () => {
  it('prints in the person\'s language', () => {
    expect(formatMoney(8050, 'EUR', 'fr').replace(/\s/g, ' ')).toBe('80,50 €');
    expect(formatMoney(8050, 'USD', 'en')).toBe('$80.50');
  });
});
