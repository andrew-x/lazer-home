"use client";

import { useRouter } from "next/navigation";
import { ALL, SelectFilter } from "@/components/form/filters";
import {
  SearchFilter,
  useUrlSearchFilter,
} from "@/components/form/search-filter";
import { Button } from "@/components/ui/button";
import {
  buildListHref,
  firstParam,
  type SearchParams,
} from "@/lib/core/list-href";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
} from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_GROUPS,
  type OpportunityGroupId,
} from "@/lib/crm/opportunity-pipeline";

const STAGE_OPTIONS = OPPORTUNITY_GROUPS.map((g) => g.id);
const STAGE_LABELS = Object.fromEntries(
  OPPORTUNITY_GROUPS.map((g) => [g.id, g.label]),
) as Record<OpportunityGroupId, string>;

/**
 * The list-view filter bar: name search (debounced), stage (kanban group), and
 * line-of-business selects. State lives in the URL — each control navigates via
 * `router.replace`, so the server page re-fetches the filtered page and the back
 * button restores prior filters. Reads its current values from the `params` the
 * page already parsed (no `useSearchParams`, so no Suspense boundary needed).
 */
export function OpportunitiesListFilters({ params }: { params: SearchParams }) {
  const router = useRouter();

  const currentStage = firstParam(params.stage) || ALL;
  const currentLob = firstParam(params.lob) || ALL;

  const { search, setSearch, currentQuery } = useUrlSearchFilter({
    basePath: "/opportunities",
    pageKey: "oppPage",
    params,
  });

  const hasFilters =
    currentQuery !== "" || currentStage !== ALL || currentLob !== ALL;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Search by opportunity or company name…"
      />

      <SelectFilter
        label="Stage"
        value={currentStage}
        options={STAGE_OPTIONS}
        labels={STAGE_LABELS}
        onChange={(value) =>
          router.replace(
            buildListHref("/opportunities", "oppPage", params, {
              stage: value === ALL ? null : value,
            }),
          )
        }
      />

      <SelectFilter
        label="Line of business"
        value={currentLob}
        options={LINE_OF_BUSINESS}
        labels={LINE_OF_BUSINESS_LABELS}
        onChange={(value) =>
          router.replace(
            buildListHref("/opportunities", "oppPage", params, {
              lob: value === ALL ? null : value,
            }),
          )
        }
      />

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.replace("/opportunities?view=list")}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
