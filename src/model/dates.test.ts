import { describe, expect, it } from 'vitest';
import { addMonths, isDay, monthRange, parseSpokenDay, parseSpokenMonth } from './dates';

// Friday 24 October 2026.
const TODAY = '2026-10-24';

describe('parseSpokenDay, a payment (past)', () => {
  it.each([
    ["aujourd'hui", '2026-10-24'],
    ['today', '2026-10-24'],
    ['hier', '2026-10-23'],
    ['ayer', '2026-10-23'],
    ['avant-hier', '2026-10-22'],
    ['il y a 3 jours', '2026-10-21'],
    ['lundi', '2026-10-19'],
    ['lundi dernier', '2026-10-19'],
    ['samedi', '2026-10-24'],
    ['dimanche', '2026-10-18'],
    ['le 5', '2026-10-05'],
    ['le 28', '2026-09-28'],
    ['3 octobre', '2026-10-03'],
    ['le 25 décembre', '2025-12-25'],
    ['12/10', '2026-10-12'],
    ['12/10/2025', '2025-10-12'],
    ['2026-10-01', '2026-10-01'],
  ])('« %s » → %s', (said, day) => {
    expect(parseSpokenDay(said, TODAY, 'past')).toEqual({ day });
  });
});

describe('parseSpokenDay, a plan (future)', () => {
  it.each([
    ['demain', { day: '2026-10-25' }],
    ['lundi', { day: '2026-10-26' }],
    ['le 5', { day: '2026-11-05' }],
    ['le 30', { day: '2026-10-30' }],
    ['en décembre', { day: '2026-12-01', wholeMonth: true }],
    ['in March', { day: '2027-03-01', wholeMonth: true }],
    ['le mois prochain', { day: '2026-11-01', wholeMonth: true }],
    ['ce mois-ci', { day: '2026-10-01', wholeMonth: true }],
    ['dans 10 jours', { day: '2026-11-03' }],
  ])('« %s »', (said, expected) => {
    expect(parseSpokenDay(said, TODAY, 'future')).toEqual(expected);
  });
});

describe('parseSpokenDay refuses what names no day', () => {
  it.each(['', 'croquettes', '31/02', 'le 31 février'])('« %s » → null', (said) => {
    expect(parseSpokenDay(said, TODAY, 'past')).toBeNull();
  });
  it('a non-string is null', () => {
    expect(parseSpokenDay(5, TODAY, 'past')).toBeNull();
  });
});

describe('parseSpokenMonth', () => {
  it.each([
    ['octobre', '2026-10'],
    ['mars', '2026-03'],
    ['décembre', '2025-12'],
    ['le mois dernier', '2026-09'],
    ['ce mois', '2026-10'],
    ['2026-07', '2026-07'],
    ['mars 2024', '2024-03'],
  ])('« %s » → %s', (said, month) => {
    expect(parseSpokenMonth(said, TODAY)).toBe(month);
  });
  it('nothing said is null', () => {
    expect(parseSpokenMonth('', TODAY)).toBeNull();
    expect(parseSpokenMonth('croquettes', TODAY)).toBeNull();
  });
});

describe('helpers', () => {
  it('month arithmetic crosses the year', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('a month range knows February', () => {
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
  });
  it('isDay refuses an impossible day', () => {
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-02-28')).toBe(true);
  });
});
