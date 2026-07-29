"use client";

import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import type { StaffProfileDrawerData } from "@/actions/staff/loadStaffProfileDrawer";
import { loadStaffProfileDrawer } from "@/actions/staff/loadStaffProfileDrawer";
import { StaffFeedbackPanel } from "@/components/feedback/staff-feedback-panel";
import { EvaluationHistory } from "@/components/performance/evaluation-history";
import { ReviewNotesPanel } from "@/components/performance/review-notes-panel";
import { CompensationSection } from "@/components/staff/compensation-section";
import { HistoryTimeline } from "@/components/staff/history-timeline";
import { PtoContent } from "@/components/staff/pto-section";
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
 * Tabs: Overview (identity facts, compensation, skills, client intro) · Projects ·
 * Time off · Peer feedback · Review notes · Evaluations · History. **Four of them
 * are viewer-dependent** — Time off, Peer feedback, Review notes and Evaluations
 * render only when their read came back non-null, i.e. when this viewer is
 * permitted that slice, so an absent tab never has to explain itself (the
 * `/feedback` convention). Projects, Time off and Evaluations are separate tabs
 * rather than Overview sections because each is a history in its own right, and a
 * review pane is read down a tab at a time.
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
                  {data.employment ? (
                    <span className="text-sm text-muted-foreground">
                      {[
                        ROLE_LABELS[data.employment.role],
                        LINE_OF_BUSINESS_LABELS[data.employment.lineOfBusiness],
                        EMPLOYMENT_TYPE_LABELS[data.employment.employmentType],
                        data.employment.isBillable
                          ? "Billable"
                          : "Non-billable",
                      ].join(" · ")}
                    </span>
                  ) : null}
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
                  <TabsTrigger value="projects">Projects</TabsTrigger>
                  {data.pto ? (
                    <TabsTrigger value="time-off">Time off</TabsTrigger>
                  ) : null}
                  {data.feedback ? (
                    <TabsTrigger value="feedback">Peer feedback</TabsTrigger>
                  ) : null}
                  {data.reviewNotes ? (
                    <TabsTrigger value="review-notes">Review notes</TabsTrigger>
                  ) : null}
                  {data.evaluationHistory ? (
                    <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
                  ) : null}
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="overview"
                  className="flex flex-col gap-8 pt-2"
                >
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Fact label="Location" value={data.location} />
                    <Fact
                      label="Joined"
                      value={data.joinDate ? formatDate(data.joinDate) : null}
                    />
                    <Fact label="Reports to" value={data.managerName} />
                  </div>

                  {/* Null means this viewer may not see comp — not "no comp on
                      file", which `CompensationSection` renders itself. */}
                  {data.compensation ? (
                    <Section title="Compensation">
                      <CompensationSection {...data.compensation} />
                    </Section>
                  ) : null}

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
                </TabsContent>

                <TabsContent value="projects" className="pt-2">
                  <StaffProjectsSection projects={data.projects} />
                </TabsContent>

                {/* Same convention as the other gated tabs: `pto` is null when
                    this viewer lacks `pto.review`, and then there is no tab at
                    all — not an empty one. */}
                {data.pto ? (
                  <TabsContent value="time-off" className="pt-2">
                    <PtoContent pto={data.pto} />
                  </TabsContent>
                ) : null}

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

                {data.evaluationHistory ? (
                  <TabsContent value="evaluations" className="pt-2">
                    <EvaluationHistory entries={data.evaluationHistory} />
                  </TabsContent>
                ) : null}

                <TabsContent value="history" className="pt-2">
                  <HistoryTimeline entries={data.history} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
