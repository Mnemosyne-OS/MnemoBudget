/**
 * The dashboard's drawings, in SVG and CSS alone (no chart library: the
 * cartridge ships react and nothing else). Every number drawn is a sum the
 * ledger made; the drawings only scale them. Motion is a CSS transition from
 * empty, started one frame after mount (hooks.useRevealed), none when the
 * person asked for less motion.
 */
import { useI18n } from '../i18n';
import { hasUnconverted } from '../model/ledger';
import type { TrendPoint } from '../model/insights';
import { formatMoney } from '../model/money';
import { monthShort } from './format';
import { useRevealed } from './hooks';

/**
 * An arc that fills with `ratio` (0..1, clamped). `over` paints it red: the
 * cap is passed. The centre holds what the caller writes (a percentage).
 */
export function Ring({ ratio, over, size = 150, stroke = 14, centre, label }: { ratio: number; over?: boolean; size?: number; stroke?: number; centre?: string; label?: string }) {
  const on = useRevealed();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = on ? Math.max(0, Math.min(1, ratio)) : 0;
  return (
    <svg className={`b-ring${over ? ' over' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle className="b-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      <circle className="b-ring-fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
        strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - shown)} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="round" />
      {centre && <text className="b-ring-centre" x="50%" y="50%" textAnchor="middle" dominantBaseline="central">{centre}</text>}
    </svg>
  );
}

/**
 * The last months as columns: spent solid, planned pale on top, the month
 * shown in green. A month holding a line without a rate carries « ≥ » on its
 * value. Heights scale to the tallest column.
 */
export function TrendBars({ points, base, current }: { points: TrendPoint[]; base: string; current: string }) {
  const { lang, t } = useI18n();
  const on = useRevealed();
  const max = Math.max(1, ...points.map((p) => p.spent.cents + p.planned.cents));
  const h = (cents: number) => (on ? `${Math.max(0, Math.min(100, (cents / max) * 100))}%` : '0%');
  return (
    <div className="b-trend" role="img" aria-label={t('dash.trend')}>
      {points.map((p) => {
        const floor = hasUnconverted(p.spent) ? '≥ ' : '';
        const title = `${monthShort(p.month, lang)} : ${floor}${formatMoney(p.spent.cents, base, lang)}${p.planned.cents ? ` + ${formatMoney(p.planned.cents, base, lang)}` : ''}`;
        return (
          <div className={`b-trend-col${p.month === current ? ' current' : ''}`} key={p.month} title={title}>
            {/* As CapBar: the pale column is spent + planned, drawn behind the solid spent one. */}
            <div className="b-trend-stack">
              <i className="planned" style={{ height: h(p.spent.cents + p.planned.cents) }} />
              <i className="spent" style={{ height: h(p.spent.cents) }} />
            </div>
            {/* The « ≥ » is written, not only in the tooltip: a touch never hovers (verifier, 2026-10-26). */}
            <span className="b-trend-label">{floor}{monthShort(p.month, lang)}</span>
          </div>
        );
      })}
    </div>
  );
}
