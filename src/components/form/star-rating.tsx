"use client";

import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A 1–`max` star rating, monochrome to match the flat editorial theme (filled =
 * foreground, empty = a faint outline). Read-only renders static stars with an
 * aria-label; interactive renders a `radiogroup` of star buttons that fill on
 * hover/focus as a preview and commit on click. `onPreviewChange` reports the
 * hovered/focused value (or null on leave) so a caller can describe the level in
 * flight; it does not change the committed `value`.
 */
export function StarRating({
  value,
  onChange,
  onPreviewChange,
  max = 5,
  readOnly = false,
  disabled = false,
  label = "Rating",
}: {
  value: number | null;
  onChange?: (value: number) => void;
  onPreviewChange?: (value: number | null) => void;
  max?: number;
  readOnly?: boolean;
  disabled?: boolean;
  /** Accessible name for the group / read-only image. */
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const stars = Array.from({ length: max }, (_, i) => i + 1);

  if (readOnly || !onChange) {
    return (
      <div
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`${label}: ${value ?? "unrated"} out of ${max}`}
      >
        {stars.map((star) => (
          <Star key={star} filled={value !== null && star <= value} />
        ))}
      </div>
    );
  }

  const preview = (next: number | null) => {
    setHover(next);
    onPreviewChange?.(next);
  };

  const active = hover ?? value ?? 0;

  return (
    <fieldset
      className="flex min-w-0 items-center gap-0.5 border-0 p-0"
      aria-label={label}
      onMouseLeave={() => preview(null)}
    >
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          // Toggle-button group: each star is "pressed" when the current value
          // reaches it, so AT announces the rating as filled stars.
          aria-pressed={value !== null && star <= value}
          aria-label={`${star} of ${max}`}
          disabled={disabled}
          className={cn(
            "rounded-sm p-0.5 text-muted-foreground/40 transition-colors",
            "hover:text-foreground focus-visible:text-foreground",
            "focus-visible:outline-1 focus-visible:outline-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            star <= active && "text-foreground",
          )}
          onMouseEnter={() => preview(star)}
          onFocus={() => preview(star)}
          onBlur={() => preview(null)}
          onClick={() => onChange(star)}
        >
          {star <= active ? (
            <IconStarFilled className="size-4" />
          ) : (
            <IconStar className="size-4" />
          )}
        </button>
      ))}
    </fieldset>
  );
}

function Star({ filled }: { filled: boolean }) {
  return filled ? (
    <IconStarFilled className="size-4 text-foreground" />
  ) : (
    <IconStar className="size-4 text-muted-foreground/40" />
  );
}
