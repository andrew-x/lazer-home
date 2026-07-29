"use client";

import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import type { StaffProfileDrawerData } from "@/actions/staff/loadStaffProfileDrawer";
import { loadStaffProfileDrawer } from "@/actions/staff/loadStaffProfileDrawer";
import { StaffFeedbackPanel } from "@/components/feedback/staff-feedback-panel";
import { ReviewNotesPanel } from "@/components/performance/review-notes-panel";
import { SkillsSection } from "@/components/staff/skills-section";
import { StaffProjectsSection } from "@/components/staff/staff-projects-section";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/** A compact label/value fact in the drawer's overview grid. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

/** A titled block inside a drawer tab — the profile page's `TabSection`, compacted. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-heading text-base font-medium leading-snug">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * A **read-only** review pane for one staff member, opened from a row elsewhere
 * (today: a name in the compensation-plan editor) so a reviewer keeps their place
 * in the list. Loads on open through `loadStaffProfileDrawer`, mirroring the
 * opportunity detail sheet.
 *
 * Read-only by design — nothing about the profile itself is editable here; the
 * header links out to the full profile for that. The **one** interactive surface
 * is the Review notes tab, which is where the review conversation actually gets
 * written up, so making it read-only would defeat the point of the drawer.
 *
 * The feedback and notes tabs render only when their reads came back non-null, so
 * the tab set is viewer-dependent (the `/feedback` convention).
 */
export function StaffProfileDrawer({
  staffId,
  open,
  onOpenChange,
}: {
  /** The staff member to show, or null when nothing is selected. */
  staffId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    execute: load,
    result,
    isPending,
    reset,
  } = useAction(loadStaffProfileDrawer);
  const [data, setData] = useState<StaffProfileDrawerData | null>(null);

  useEffect(() => {
    if (open && staffId) {
      load({ staffId });
    } else if (!open) {
      setData(null);
      reset();
    }
  }, [open, staffId, load, reset]);

  useEffect(() => {
    if (result.data) setData(result.data);
  }, [result.data]);

  // Re-load after a note is written/shared/deleted. The drawer fetches its own
  // data, so it refreshes itself rather than calling `router.refresh()` — that
  // would re-render the plan editor underneath, mid-edit.
  const refresh = useCallback(() => {
    if (staffId) load({ staffId });
  }, [staffId, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[56rem]">
        <SheetTitle className="sr-only">
          {data?.name ?? "Staff profile"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Profile details for review
        </SheetDescription>

        {data === null ? (
          <div className="flex flex-col gap-4 p-6">
            {isPending ? (
              <>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-40 w-full" />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                That profile is no longer available.
              </p>
            )}
          </div>
        ) : (
          <>
            <SheetHeader className="gap-2 border-b p-6 pr-14">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-heading text-lg font-semibold tracking-tight">
                    {data.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {data.employment
                      ? [
                          ROLE_LABELS[data.employment.role],
                          LINE_OF_BUSINESS_LABELS[
                            data.employment.lineOfBusiness
                          ],
                          EMPLOYMENT_TYPE_LABELS[
                            data.employment.employmentType
                          ],
                        ].join(" · ")
                      : data.email}
                  </span>
                </div>
                {staffId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/staff/${staffId}`} />}
                  >
                    Open full profile
                    <IconExternalLink />
                  </Button>
                ) : null}
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <Tabs defaultValue="overview">
                <TabsList variant="line" className="mb-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  {data.feedback ? (
                    <TabsTrigger value="feedback">Peer feedback</TabsTrigger>
                  ) : null}
                  {data.reviewNotes ? (
                    <TabsTrigger value="review-notes">Review notes</TabsTrigger>
                  ) : null}
                </TabsList>

                <TabsContent
                  value="overview"
                  className="flex flex-col gap-8 pt-2"
                >
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Fact label="Email" value={data.email} />
                    <Fact label="Location" value={data.location} />
                    <Fact
                      label="Joined"
                      value={data.joinDate ? formatDate(data.joinDate) : null}
                    />
                    <Fact label="Reports to" value={data.managerName} />
                  </div>

                  <Section title="Skills">
                    <SkillsSection skills={data.skills} />
                  </Section>

                  <Section title="Client intro">
                    {data.clientIntro ? (
                      <p className="text-sm whitespace-pre-wrap">
                        {data.clientIntro}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No client intro yet.
                      </p>
                    )}
                  </Section>

                  <Section title="Projects">
                    <StaffProjectsSection projects={data.projects} />
                  </Section>
                </TabsContent>

                {data.feedback ? (
                  <TabsContent value="feedback" className="pt-2">
                    <StaffFeedbackPanel
                      view={data.feedback}
                      staffName={data.name}
                    />
                  </TabsContent>
                ) : null}

                {data.reviewNotes && staffId ? (
                  <TabsContent value="review-notes" className="pt-2">
                    <ReviewNotesPanel
                      staffId={staffId}
                      staffName={data.name}
                      view={data.reviewNotes}
                      onChanged={refresh}
                    />
                  </TabsContent>
                ) : null}
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
