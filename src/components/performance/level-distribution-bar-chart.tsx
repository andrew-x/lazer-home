"use client";

import { useMemo, useState } from "react";
import type { LevelCount } from "@/lib/performance/rating-stats";
import { formatLevel } from "@/lib/staff/staff-rating";

// viewBox coordinate space — the SVG scales to its container width, keeping this
// aspect ratio. Bars/lines use non-scaling strokes so they stay crisp.
const VB_WIDTH = 720;
const VB_HEIGHT = 280;
const MARGIN = { top: 16, right: 16, bottom: 32, left: 44 };
const PLOT_LEFT = MARGIN.left;
const PLOT_RIGHT = VB_WIDTH - MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_BOTTOM = VB_HEIGHT - MARGIN.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const MAX_TICKS = 5;
// Fraction of each column's slot taken by the bar (rest is the gap between bars).
const BAR_FILL = 0.6;

/** Round a raw max headcount up to a clean integer axis top with ≤ MAX_TICKS steps. */
function niceAxis(maxCount: number): { max: number; ticks: number[] } {
  if (maxCount <= 0) return { max: 1, ticks: [0, 1] };
  // Step is a whole number so count ticks are integers; keep the tick count low.
  const step = Math.ceil(maxCount / (MAX_TICKS - 1));
  const max = step * (MAX_TICKS - 1);
  const ticks = Array.from({ length: MAX_TICKS }, (_, i) => i * step);
  return { max, ticks };
}

/**
 * A single-series bar chart of headcount per level (L0–L4). Bars start at a
 * **zero baseline** — bar area encodes count, so a non-zero baseline would lie
 * (unlike the scatter). Hovering a bar shows its exact count; the `<title>` is the
 * accessible per-bar label. Hand-rolled SVG per `docs/ui.md` (no chart library).
 */
export function LevelDistributionBarChart({
  data,
  caption,
}: {
  data: LevelCount[];
  caption: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const { bars, ticks, yOf } = useMemo(() => {
    const maxCount = Math.max(0, ...data.map((d) => d.count));
    const { max, ticks } = niceAxis(maxCount);

    const yOf = (count: number) => PLOT_BOTTOM - (count / max) * PLOT_HEIGHT;

    const slot = data.length > 0 ? PLOT_WIDTH / data.length : PLOT_WIDTH;
    const barWidth = slot * BAR_FILL;

    const bars = data.map((d, i) => {
      const slotLeft = PLOT_LEFT + i * slot;
      const x = slotLeft + (slot - barWidth) / 2;
      const y = yOf(d.count);
      return {
        level: d.level,
        count: d.count,
        x,
        y,
        width: barWidth,
        height: PLOT_BOTTOM - y,
        labelX: slotLeft + slot / 2,
      };
    });

    return { bars, ticks, yOf };
  }, [data]);

  const active = hovered != null ? bars[hovered] : null;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={caption}
      >
        {/* Horizontal gridlines + y-axis count labels */}
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
                {tick}
              </text>
            </g>
          );
        })}

        {/* Zero baseline */}
        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={PLOT_BOTTOM}
          y2={PLOT_BOTTOM}
          className="stroke-border"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {/* One bar per level; hover shows the exact count */}
        {bars.map((bar, i) => {
          const isActive = hovered === i;
          return (
            <g key={bar.level}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG data mark takes pointer handlers for the hover tooltip; the <title> child is the accessible label. */}
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                className="fill-primary transition-opacity"
                fillOpacity={isActive ? 1 : 0.75}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${formatLevel(bar.level)}: ${bar.count} staff`}</title>
              </rect>
              {/* X-axis level label */}
              <text
                x={bar.labelX}
                y={PLOT_BOTTOM + 16}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={12}
                fontWeight={500}
              >
                {formatLevel(bar.level)}
              </text>
            </g>
          );
        })}

        {/* Hover tooltip */}
        {active && (
          <BarTooltip
            x={active.x + active.width / 2}
            y={active.y}
            label={`${formatLevel(active.level)} · ${active.count} staff`}
          />
        )}
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

/** A small label bubble above the hovered bar, clamped inside the plot. */
function BarTooltip({ x, y, label }: { x: number; y: number; label: string }) {
  const width = label.length * 6.4 + 16;
  const height = 20;
  const left = Math.min(Math.max(x - width / 2, PLOT_LEFT), PLOT_RIGHT - width);
  // Prefer above the bar; drop just inside if it would clip the top.
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
