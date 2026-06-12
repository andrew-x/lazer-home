"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = ComponentProps<typeof Button> & {
  /** Accessible label — shown as a tooltip and set as aria-label. Required. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
};

/**
 * Icon-only button. Always pairs the icon with a tooltip + aria-label so the
 * action is discoverable and accessible. Use this for any icon-only control.
 * Must be rendered within a TooltipProvider (the root layout provides one).
 */
export function IconButton({
  label,
  side = "bottom",
  variant = "ghost",
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size="icon"
            aria-label={label}
            {...props}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
