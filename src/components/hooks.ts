/**
 * Motion and layout hooks. Hooks only (no component), so Fast Refresh keeps
 * working in the files that import them.
 *
 * Rule 13: every requestAnimationFrame loop here is cancelled on cleanup.
 * A DOM without `matchMedia` (a test) counts as « reduce motion »: figures
 * show their final value at once, so a test reads the sum, never a frame.
 */
import { useEffect, useRef, useState } from 'react';

function media(query: string, fallback: boolean): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
    return window.matchMedia(query).matches;
  } catch (err) {
    console.warn('[mnemo-budget] matchMedia unavailable:', err);
    return fallback;
  }
}

/** True when the person asked the OS for less motion, or when the DOM cannot say. */
export function prefersReducedMotion(): boolean {
  return media('(prefers-reduced-motion: reduce)', true);
}

/** Follows a media query live; `fallback` where the DOM has no matchMedia. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => media(query, fallback));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** A phone or a narrow window: the side rail becomes a bottom bar. */
export function useNarrow(): boolean {
  return useMediaQuery('(max-width: 899px)', false);
}

/**
 * Below this the window is a tile: one figure, nothing to navigate (doc 177 §13.7).
 * Small BOTH ways (under 560 × 640), or very low (under 420 high): a narrow but
 * tall window is a phone's shape and keeps its screens with the bottom bar.
 */
export const MINI_MAX_WIDTH = 560;
export const MINI_MAX_HEIGHT = 640;
export const MINI_LOW_HEIGHT = 420;

/**
 * A small window (the person shrank it on the board): the mini view, a tile
 * with the month's figure. Read from the iframe's own size, which IS the
 * window's; a test DOM (1024×768) is never mini.
 */
export function useMini(): boolean {
  const read = () => typeof window !== 'undefined' && (window.innerHeight < MINI_LOW_HEIGHT || (window.innerWidth < MINI_MAX_WIDTH && window.innerHeight < MINI_MAX_HEIGHT));
  const [mini, setMini] = useState(read);
  useEffect(() => {
    const onResize = () => setMini(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mini;
}

/**
 * A figure that counts from the value it showed to `target` (eased, `ms`
 * long). With motion reduced it is the target at once. The frame loop is
 * cancelled when the target changes again or the component leaves.
 */
export function useCountUp(target: number, ms = 650): number {
  // From zero on the first paint, so the figure counts up when the screen opens.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  // The value on screen, readable by the next effect without a render in between.
  const shownRef = useRef(shown);
  useEffect(() => {
    if (prefersReducedMotion()) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = shownRef.current;
    if (from === target) return undefined;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      const value = Math.round(from + (target - from) * eased);
      shownRef.current = value;
      setShown(value);
      if (p < 1) raf = requestAnimationFrame(tick);
      else window.clearTimeout(settle);
    };
    raf = requestAnimationFrame(tick);
    // A hidden frame gets no animation frames at all (measured: 0 rAF/s): the sum is
    // still on screen within a second, whatever the frames did. Money is never left at 0.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      shownRef.current = target;
      setShown(target);
    }, ms + 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [target, ms]);
  return shown;
}

/**
 * False on the first paint, true one frame later, so a bar or an arc
 * transitions from empty to its value. True at once with motion reduced.
 */
export function useRevealed(): boolean {
  const [on, setOn] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (on) return undefined;
    // A frame when the page is visible; a timer when it is not (a hidden frame gets no frames), so a bar is never left empty.
    const raf = requestAnimationFrame(() => setOn(true));
    const timer = window.setTimeout(() => setOn(true), 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [on]);
  return on;
}
