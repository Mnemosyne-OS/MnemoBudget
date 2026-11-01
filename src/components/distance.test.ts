import { describe, expect, it } from 'vitest';
import { FAR_ENTER, FAR_EXIT, nextFar } from './distance';

describe('the far view follows the host zoom with a hysteresis (same thresholds as the host)', () => {
  it('enters below 0.7 and leaves at 0.78, never flickering in between', () => {
    expect(FAR_ENTER).toBe(0.7);
    expect(FAR_EXIT).toBe(0.78);
    expect(nextFar(0.69, false)).toBe(true);
    expect(nextFar(0.7, false)).toBe(false);
    expect(nextFar(0.75, true)).toBe(true);
    expect(nextFar(0.75, false)).toBe(false);
    expect(nextFar(0.78, true)).toBe(false);
  });

  it('🎭 no zoom received is the normal view, never the far view on a guess', () => {
    expect(nextFar(null, false)).toBe(false);
    expect(nextFar(null, true)).toBe(false);
    expect(nextFar(Number.NaN, true)).toBe(false);
  });
});
