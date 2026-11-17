'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type LineSeries = { name: string; color: string; values: number[] };

const fmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const label = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/**
 * Hand-rolled SVG line chart (no chart library: two series and a crosshair do
 * not justify one). Follows the dataviz rules: one y-axis, 2px lines, hairline
 * grid, legend for 2+ series, crosshair tooltip listing every series (also on
 * keyboard focus with the arrow keys), and a table view of the same numbers.
 */
export function LineChart({
  days,
  series,
  height = 220,
  title,
}: {
  days: string[];
  series: LineSeries[];
  height?: number;
  title: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = { l: 40, r: 12, t: 10, b: 26 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const step = days.length > 1 ? iw / (days.length - 1) : 0;
  const x = (i: number) => m.l + (days.length > 1 ? i * step : iw / 2);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 70))));

  const pick = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    const i = days.length > 1 ? Math.round((px - m.l) / step) : 0;
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  };

  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 80, 0), width - 168);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{title}</figcaption>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={wrap} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. Use the arrow keys to read each day; the same numbers are in the table below.`}
          tabIndex={0}
          className="block touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            setHover((h) => {
              const cur = h ?? days.length - 1;
              return Math.min(days.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
            });
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={m.l}
                x2={width - m.r}
                y1={y(t)}
                y2={y(t)}
                style={{ stroke: t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)' }}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={m.l - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10.5px] tabular-nums"
              >
                {fmt.format(t)}
              </text>
            </g>
          ))}
          {days.map((day, i) =>
            i % labelEvery === 0 || i === days.length - 1 ? (
              <text
                key={day}
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground text-[10.5px]"
              >
                {label(day)}
              </text>
            ) : null,
          )}
          {hover !== null ? (
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} style={{ stroke: 'var(--viz-axis)' }} strokeWidth={1} />
          ) : null}
          {series.map((s) => (
            <g key={s.name}>
              <path
                d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {(hover === null ? [s.values.length - 1] : [hover]).map((i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(s.values[i] ?? 0)}
                  r={4}
                  style={{ fill: s.color, stroke: 'var(--card)' }}
                  strokeWidth={2}
                />
              ))}
            </g>
          ))}
        </svg>
        {hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-42 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: tipLeft }}
          >
            <p className="mb-1 text-muted-foreground">{label(days[hover]!)}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="font-semibold tabular-nums text-foreground">{full.format(s.values[hover] ?? 0)}</span>
                <span className="text-muted-foreground">{s.name}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground" aria-controls={tableId}>
          Show as table
        </summary>
        <div className="scroll-slim mt-2 max-h-64 overflow-auto rounded-md border">
          <table id={tableId} className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                {series.map((s) => (
                  <th key={s.name} className="px-3 py-1.5 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} className="border-t">
                  <td className="px-3 py-1">{day}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-1 text-right">
                      {full.format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
