/**
 * Small shared components: the icons (drawn, never words, for a view switch:
 * style-cartouche §3), a cap bar, a tag, a figure tile. Components only, so
 * Fast Refresh keeps working (the text helpers live in format.ts, the hooks
 * in hooks.ts).
 */
import type { ReactNode } from 'react';
import { useRevealed } from './hooks';

const PATHS: Record<string, string> = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  pockets: 'M3 7a2 2 0 0 1 2-2h12v3M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2zM16 13h.01',
  lines: 'M5 7h14M5 12h14M5 17h9',
  review: 'M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  folder: 'M3 6h6l2 2h10v11H3z',
  back: 'M19 12H5M11 6l-6 6 6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  repeat: 'M17 2l4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  swap: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  coins: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6',
  warn: 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
  language: 'M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M12 3v18M4.5 7.5h15M4.5 16.5h15',
  memory: 'M12 3a7 7 0 0 1 7 7c0 3-2 4.5-3 6v2H8v-2c-1-1.5-3-3-3-6a7 7 0 0 1 7-7zM9 21h6',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
};

/** A line icon drawn in the current text colour; its meaning goes in the button's title and aria-label. */
export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/**
 * Spent (solid) and planned (pale) against a cap. Past the cap, red. The
 * fill grows from empty on the first paint (transition in CSS).
 */
export function CapBar({ spent, planned, cap, thin }: { spent: number; planned: number; cap: number; thin?: boolean }) {
  const on = useRevealed();
  const pct = (n: number) => (on ? `${Math.max(0, Math.min(100, (n / cap) * 100))}%` : '0%');
  return (
    <div className={`b-bar${spent > cap ? ' over' : ''}${thin ? ' thin' : ''}`} role="presentation">
      <i className="planned" style={{ width: pct(spent + planned) }} />
      <i style={{ width: pct(spent) }} />
    </div>
  );
}

/** A share of a whole (0..1), the same bar without a cap. */
export function ShareBar({ ratio, tone }: { ratio: number; tone?: 'over' | 'muted' }) {
  const on = useRevealed();
  return (
    <div className={`b-bar thin${tone === 'over' ? ' over' : ''}${tone === 'muted' ? ' muted' : ''}`} role="presentation">
      <i style={{ width: on ? `${Math.max(0, Math.min(100, ratio * 100))}%` : '0%' }} />
    </div>
  );
}

/** A small label beside a line: « en retard », « revient », « à vérifier ». */
export function Tag({ tone, children }: { tone?: 'warn' | 'over' | 'ok'; children: ReactNode }) {
  return <span className={`b-tag${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** A card's heading: an icon, a title, and whatever sits at the right (a count, a button). */
export function CardHead({ icon, title, right }: { icon?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="b-card-head">
      <h2>{icon && <Icon name={icon} size={17} />}{title}</h2>
      {right}
    </div>
  );
}

/** One figure of the dashboard: a label, the value, notes under it. `testId` names the value for the tests. */
export function FigureTile({ label, value, tone, notes, testId, children }: {
  label: ReactNode; value: ReactNode; tone?: 'over' | 'ok' | 'muted'; notes?: ReactNode; testId?: string; children?: ReactNode;
}) {
  return (
    <div className="glass b-figure">
      <span className="b-figure-label">{label}</span>
      <span className={`b-figure-value${tone ? ` ${tone}` : ''}`} data-testid={testId}>{value}</span>
      {notes}
      {children}
    </div>
  );
}

/** What an empty list says, with room for one action. */
export function Empty({ icon = 'spark', children, action }: { icon?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="b-empty">
      <span className="b-empty-icon"><Icon name={icon} size={22} /></span>
      <p>{children}</p>
      {action}
    </div>
  );
}
