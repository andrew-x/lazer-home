"use client";

import { useMemo, useState } from "react";

// viewBox coordinate space — the SVG scales to its container width, keeping this
// aspect ratio. Marks/lines use non-scaling strokes so they stay crisp.
const VB_WIDTH = 720;
const VB_HEIGHT = 280;
const MARGIN = { top: 16, right: 16, bottom: 20 };
const PLOT_RIGHT = VB_WIDTH - MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_BOTTOM = VB_HEIGHT - MARGIN.bottom;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const TICK_COUNT = 5;

// The left gutter holds the right-anchored y-axis labels, so it's sized from the
// widest one rather than fixed: "CA$1,250,000" needs ~90, "CA$85" only ~42, and a
// gutter cut for the longest would waste half the width on an hourly-rate axis.
// SVG text can't be measured without the DOM, so estimate from the character count
// — 6.8 per char at this font size, which the tooltip's sizing shares. That's above
// the digit advance on purpose: every label carries a wider uppercase currency
// prefix ("CA$", "US$"), and under-estimating clips the label off the viewBox.
// Then clamp: MIN keeps a short label (hourly rate) clear of the left edge instead
// of flush against it, MAX caps the bite a pathological label takes out of the plot.
const LABEL_FONT_SIZE = 11;
const LABEL_CHAR_WIDTH = 6.8;
const AXIS_LABEL_GAP = 8;
const MIN_PLOT_LEFT = 60;
const MAX_PLOT_LEFT = 108;

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

  const { points, ticks, yOf, plotLeft } = useMemo(() => {
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

    // Size the gutter to the labels actually rendered — the ticks, not the raw
    // values, since the padded domain can round to a wider string.
    const widestLabel = ticks.reduce(
      (widest, tick) => Math.max(widest, formatValue(tick).length),
      0,
    );
    const plotLeft = Math.min(
      MAX_PLOT_LEFT,
      Math.max(
        MIN_PLOT_LEFT,
        Math.ceil(widestLabel * LABEL_CHAR_WIDTH) + AXIS_LABEL_GAP,
      ),
    );
    const plotWidth = PLOT_RIGHT - plotLeft;

    const yOf = (value: number) =>
      PLOT_BOTTOM -
      ((value - domainMin) / (domainMax - domainMin)) * PLOT_HEIGHT;

    const xOf = (index: number) =>
      sorted.length <= 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (index / (sorted.length - 1)) * plotWidth;

    const points: Point[] = sorted.map((value, i) => ({
      id: i,
      cx: xOf(i),
      cy: yOf(value),
      value,
    }));

    return { points, ticks, yOf, plotLeft };
  }, [values, formatValue]);

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
                x1={plotLeft}
                x2={PLOT_RIGHT}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={plotLeft - AXIS_LABEL_GAP}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={LABEL_FONT_SIZE}
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        {/* Baseline (x-axis ticks are intentionally hidden) */}
        <line
          x1={plotLeft}
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
            plotLeft={plotLeft}
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
  plotLeft,
  label,
}: {
  x: number;
  y: number;
  /** The plot's left edge — dynamic, so the clamp tracks the axis gutter. */
  plotLeft: number;
  label: string;
}) {
  const width = label.length * LABEL_CHAR_WIDTH + 16;
  const height = 20;
  const left = Math.min(Math.max(x - width / 2, plotLeft), PLOT_RIGHT - width);
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
        fontSize={LABEL_FONT_SIZE}
        fontWeight={500}
      >
        {label}
      </text>
    </g>
  );
}
