/**
 * distance.ts — is the board zoomed out far enough that MnemoBudget should
 * draw its far view? (The same brick as Ember's `lib/distance.ts`.)
 *
 * The host sends the canvas zoom in every MNEMO_CONFIG_UPDATE (cartridge-sdk
 * `MnemoHostConfig.zoom`): the iframe cannot measure it, since the plane is
 * CSS-scaled around it and `innerWidth` never changes.
 *
 * Same thresholds as the host (renderer lib/canvasLod.ts): enter below 0.7,
 * leave at 0.78 and above. The gap is the hysteresis that stops a window from
 * flickering between layouts at the edge.
 *
 * 🎭 No zoom received = unknown = the normal view, never the far view on a
 * guess (the SDK contract says so). Opened in a plain browser, never far.
 */
import { useSyncExternalStore } from 'react';

export const FAR_ENTER = 0.7;
export const FAR_EXIT = 0.78;

/** The far state after one zoom reading, with the hysteresis: `wasFar` is what it was. */
export function nextFar(zoom: number | null, wasFar: boolean): boolean {
  if (zoom === null || !Number.isFinite(zoom)) return false;
  return wasFar ? zoom < FAR_EXIT : zoom < FAR_ENTER;
}

let far = false;
const listeners = new Set<() => void>();

/** Feed every zoom the host sends. Ignores messages that carry none. */
export function adoptHostZoom(zoom: unknown): void {
  if (typeof zoom !== 'number') return;
  const next = nextFar(zoom, far);
  if (next === far) return;
  far = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** React's view of the store above: re-renders when the board crosses a threshold. */
export function useFar(): boolean {
  return useSyncExternalStore(subscribe, () => far);
}
