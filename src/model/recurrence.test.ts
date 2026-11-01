import { describe, expect, it } from 'vitest';
import { occurrencesBetween, repeatOf, ruleFor } from './recurrence';
import type { Recurring } from './types';

const rec = (start: string, rrule: string): Recurring => ({
  id: 'r1', amountCents: 120000, currency: 'EUR', pocketId: 'p1', rrule, start, origin: 'typed',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('recurring lines, walked by the Agenda engine', () => {
  it('the rent on the 5th, every month from its start', () => {
    const r = rec('2026-09-05', ruleFor('monthly', '2026-09-05'));
    expect(occurrencesBetween(r, '2026-10-01', '2026-10-31')).toEqual(['2026-10-05']);
    expect(occurrencesBetween(r, '2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('a line due on the 31st falls on the last day of February', () => {
    const r = rec('2026-01-31', ruleFor('monthly', '2026-01-31'));
    expect(occurrencesBetween(r, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
    expect(occurrencesBetween(r, '2026-04-01', '2026-04-30')).toEqual(['2026-04-30']);
  });

  it('a line due on the 30th stays on the 30th in a 31-day month', () => {
    const r = rec('2026-01-30', ruleFor('monthly', '2026-01-30'));
    expect(occurrencesBetween(r, '2026-03-01', '2026-03-31')).toEqual(['2026-03-30']);
    expect(occurrencesBetween(r, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
  });

  it('the cleaner every Tuesday', () => {
    const r = rec('2026-10-06', ruleFor('weekly', '2026-10-06'));
    expect(occurrencesBetween(r, '2026-10-01', '2026-10-31')).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('yearly insurance', () => {
    const r = rec('2025-03-15', ruleFor('yearly', '2025-03-15'));
    expect(occurrencesBetween(r, '2026-03-01', '2026-03-31')).toEqual(['2026-03-15']);
  });

  it('reads back what it wrote, and an unreadable rule has no date', () => {
    expect(repeatOf(ruleFor('weekly', '2026-10-06'))).toBe('weekly');
    expect(repeatOf(ruleFor('monthly', '2026-10-31'))).toBe('monthly');
    expect(repeatOf('FREQ=HOURLY')).toBeNull();
    expect(occurrencesBetween(rec('2026-10-01', 'FREQ=HOURLY'), '2026-10-01', '2026-10-31')).toEqual([]);
  });
});
