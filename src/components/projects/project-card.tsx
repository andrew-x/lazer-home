"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectListItem } from "@/actions/projects/getProjectsList";
import { useProjectsCurrency } from "@/components/projects/projects-currency";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { aggregateMoneyFormatters } from "@/lib/format/currency";
import { formatDateRange, formatPercent } from "@/lib/format/format";
import {
  PROJECT_FLAG_LABELS,
  PROJECT_FLAG_VARIANTS,
} from "@/lib/projects/project-flags";
import { marginAmountTone } from "@/lib/projects/project-margin";
import { PROJECT_ROLE_STATUS_LABELS } from "@/lib/projects/project-role-status";

/**
 * One project as a clickable card linking to its detail page.
 *
 * The badge row carries only the *derived risk tags* (`project-flags.ts`) — status
 * and line of business are facts, not warnings, so they read as fields in the
 * definition list below and leave the badges to mean "look at this one". A client
 * component because the margin figure follows the list's currency toggle.
 */
export function ProjectCard({ project }: { project: ProjectListItem }) {
  const { displayCurrency } = useProjectsCurrency();

  // `Card` is a plain <div> that does not forward a Base UI `render` prop, so we
  // wrap it in the Link and carry the padding/hover/layout classes on the Card.
  return (
    <Link
      href={`/projects/${project.id}`}
      aria-label={project.name}
      className="block"
    >
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:bg-accent">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{project.name}</span>
          <span className="truncate text-sm text-muted-foreground">
            {project.companyName}
          </span>
        </div>

        {project.flags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {project.flags.map((flag) => (
              <Badge key={flag} variant={PROJECT_FLAG_VARIANTS[flag]}>
                {PROJECT_FLAG_LABELS[flag]}
              </Badge>
            ))}
          </div>
        ) : null}

        <dl className="mt-auto flex flex-col gap-1 text-sm">
          <CardField label="Status">
            {PROJECT_ROLE_STATUS_LABELS[project.status]}
          </CardField>
          {/* The same term the list's own filter uses, so the card and the control
              above it name the same thing. */}
          <CardField label="Line of business">
            {project.linesOfBusiness.length > 0 ? (
              project.linesOfBusiness
                .map((lob) => LINE_OF_BUSINESS_LABELS[lob])
                .join(", ")
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </CardField>
          <CardField label="Delivery">
            {project.deliveryManagerNames.length > 0 ? (
              project.deliveryManagerNames.join(", ")
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </CardField>
          <CardField label="Dates">
            {project.startDate && project.endDate ? (
              formatDateRange(project.startDate, project.endDate)
            ) : (
              <span className="text-muted-foreground">No dates</span>
            )}
          </CardField>
          {/* Omitted entirely, not blanked, when the viewer lacks
              `projects.viewMargin` — the server never sent a figure. */}
          {project.margin ? (
            <CardField label="Margin">
              <MarginValue
                figure={project.margin[displayCurrency]}
                hasBudget={project.billingType !== null}
                roleCount={project.roleCount}
                currency={displayCurrency}
              />
            </CardField>
          ) : null}
        </dl>
      </Card>
    </Link>
  );
}

/** One `Delivery`-style row: a muted term and a truncating definition. */
function CardField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

/**
 * The money leads and the percentage supports it (ADR 0053). The two reasons there is
 * no figure to lead with say so in words rather than showing a bare "—": "nobody has
 * priced this yet" and "nobody is staffed on it yet" are actionable, where a dash
 * reads as a number we lost.
 */
function MarginValue({
  figure,
  hasBudget,
  roleCount,
  currency,
}: {
  figure: { margin: number | null; marginPercent: number | null };
  hasBudget: boolean;
  roleCount: number;
  currency: Parameters<typeof aggregateMoneyFormatters>[0];
}) {
  if (!hasBudget) {
    return <span className="text-muted-foreground">No budget</span>;
  }
  if (roleCount === 0) {
    return <span className="text-muted-foreground">No roles</span>;
  }

  const { money } = aggregateMoneyFormatters(currency);
  return (
    <>
      <span className={cn("tabular-nums", marginAmountTone(figure.margin))}>
        {money(figure.margin)}
      </span>
      {figure.marginPercent != null ? (
        <span className="ml-1.5 tabular-nums text-muted-foreground">
          {formatPercent(figure.marginPercent)}
        </span>
      ) : null}
    </>
  );
}
