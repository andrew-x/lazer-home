"use client";

import { Fragment } from "react";
import type { EntityRef } from "@/actions/crm/getOpportunity";
import { InternalLink } from "@/components/internal-link";

/**
 * Comma-separated entity links to each item's detail page (`{basePath}/{id}`),
 * or a muted "None" when empty. Read-mode display for the people/company fields.
 */
export function EntityLinks({
  items,
  basePath,
}: {
  items: EntityRef[];
  basePath: string;
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 ? ", " : null}
          <InternalLink
            href={`${basePath}/${item.id}`}
            target="_blank"
            rel="noreferrer"
          >
            {item.name}
          </InternalLink>
        </Fragment>
      ))}
    </>
  );
}
