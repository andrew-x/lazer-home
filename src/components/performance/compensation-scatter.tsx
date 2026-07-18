"use client";

import { useMemo, useState } from "react";

// viewBox coordinate space — the SVG scales to its container width, keeping this
// aspect ratio. Marks/lines use non-scaling strokes so they stay crisp.
const VB_WIDTH = 720;
const VB_HEIGHT = 280;
// Left margin is generous so long currency labels (e.g. "CA$1,250,000") don't
// overflow the frame — they're right-anchored just inside PLOT_LEFT.
const MARGIN = { top: 16, right: 16, bottom: 20, left: 100 };
const PLOT_LEFT = MARGIN.left;
const PLOT_RIGHT = VB_WIDTH - MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_BOTTOM = VB_HEIGHT - MARGIN.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const TICK_COUNT = 5;

type Point = {
  id: number;
  cx: number;
  cy: number;
  value: number;
};

/**
 * A single-series scatter of one numeric measure across staff, sorted ascending.
 * Each dot is one (anonymous) person; the x position is just their rank (1..n,
 * ticks hidden), so the eye reads the distribution's shape. Values arrive already
 * normalized to the display currency; `formatValue` handles axis + tooltip
 * formatting. The data carries no identity — hovering a dot shows only its value.
 */
export function CompensationScatter({
  values,
  formatValue,
  caption,
}: {
  values: number[];
  formatValue: (value: number) => string;
  caption: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const { points, ticks, yOf } = useMemo(() => {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;

    // Pad the domain so extremes don't sit on the frame. Scatter dots (unlike
    // bars) carry no area-from-zero meaning, so a non-zero baseline is honest and
    // keeps the spread legible.
    const pad = max === min ? Math.abs(max) * 0.1 || 1 : (max - min) * 0.08;
    const domainMin = min - pad;
    const domainMax = max + pad;

    const ticks = Array.from(
      { length: TICK_COUNT },
      (_, i) => domainMin + (i / (TICK_COUNT - 1)) * (domainMax - domainMin),
    );

    const yOf = (value: number) =>
      PLOT_BOTTOM -
      ((value - domainMin) / (domainMax - domainMin)) * PLOT_HEIGHT;

    const xOf = (index: number) =>
      sorted.length <= 1
        ? PLOT_LEFT + PLOT_WIDTH / 2
        : PLOT_LEFT + (index / (sorted.length - 1)) * PLOT_WIDTH;

    const points: Point[] = sorted.map((value, i) => ({
      id: i,
      cx: xOf(i),
      cy: yOf(value),
      value,
    }));

    return { points, ticks, yOf };
  }, [values]);

  const active = hovered != null ? points[hovered] : null;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={caption}
      >
        {/* Horizontal gridlines + y-axis value labels */}
        {ticks.map((tick) => {
          const y = yOf(tick);
          return (
            <g key={tick}>
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PLOT_LEFT - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={11}
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        {/* Baseline (x-axis ticks are intentionally hidden) */}
        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={PLOT_BOTTOM}
          y2={PLOT_BOTTOM}
          className="stroke-border"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {/* One dot per staff member; hover shows the value (no identity) */}
        {points.map((p) => {
          const isActive = hovered === p.id;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG data mark takes pointer handlers for the hover tooltip; the <title> child is the accessible label.
            <circle
              key={p.id}
              cx={p.cx}
              cy={p.cy}
              r={isActive ? 5 : 3.5}
              className="fill-primary transition-opacity"
              fillOpacity={isActive ? 1 : 0.7}
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>{formatValue(p.value)}</title>
            </circle>
          );
        })}

        {/* Hover tooltip */}
        {active && (
          <ScatterTooltip
            x={active.cx}
            y={active.cy}
            label={formatValue(active.value)}
          />
        )}
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

/** A small label bubble above the hovered dot, clamped inside the plot. */
function ScatterTooltip({
  x,
  y,
  label,
}: {
  x: number;
  y: number;
  label: string;
}) {
  const width = label.length * 6.4 + 16;
  const height = 20;
  const left = Math.min(Math.max(x - width / 2, PLOT_LEFT), PLOT_RIGHT - width);
  // Prefer above the dot; drop below if it would clip the top.
  const above = y - height - 8 >= PLOT_TOP;
  const top = above ? y - height - 8 : y + 8;

  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={4}
        className="fill-popover stroke-border"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={left + width / 2}
        y={top + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-popover-foreground"
        fontSize={11}
        fontWeight={500}
      >
        {label}
      </text>
    </g>
  );
}
