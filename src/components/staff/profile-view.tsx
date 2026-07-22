import { IconExternalLink, IconPencil } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ManualOfMeEntry } from "@/actions/responses/getManualOfMe";
import type { WaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import type { HistoryEntry } from "@/actions/staff/getStaffHistory";
import type { StaffProfile } from "@/actions/staff/getStaffProfile";
import type { StaffProjectSummary } from "@/actions/staff/getStaffProjects";
import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { CompensationSection } from "@/components/staff/compensation-section";
import { EditClientIntroDialog } from "@/components/staff/edit-client-intro-dialog";
import { EditLinksDialog } from "@/components/staff/edit-links-dialog";
import { EditResumeDialog } from "@/components/staff/edit-resume-dialog";
import { HistoryTimeline } from "@/components/staff/history-timeline";
import { ManualOfMeSection } from "@/components/staff/manual-of-me-section";
import { PtoContent } from "@/components/staff/pto-section";
import { SkillsSection } from "@/components/staff/skills-section";
import { StaffProjectsSection } from "@/components/staff/staff-projects-section";
import { WaysOfWorkingSection } from "@/components/staff/ways-of-working-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RIPPLING_TIME_OFF_URL } from "@/lib/core/constants";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate, formatTimestamp, initialsFor } from "@/lib/format/format";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/** A profile URL row, or an em dash when absent. */
function LinkRow({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-right font-medium text-primary underline-offset-4 hover:underline"
        >
          {url}
        </a>
      ) : (
        <span className="font-medium text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** A labelled fact in the left-rail meta card (small uppercase label + value). */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** A titled block inside a tab: heading row (with optional action) + content. */
function TabSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <h3 className="font-heading text-base font-medium leading-snug">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Read view of a staff member's profile: a left rail (identity, links,
 * compensation) beside a tabbed right column (overview, manual of me, resume,
 * history). Links, intro, skills and résumé are editable when `canEdit`. Shared
 * by `/profile` (self) and `/staff/[id]`.
 */
export function ProfileView({
  staffId,
  imageUrl,
  profile,
  projects,
  manualOfMe,
  waysOfWorking,
  history,
  pto,
  canEdit,
  canViewCompensation,
}: {
  staffId: string;
  imageUrl: string | null;
  profile: StaffProfile;
  /** Projects this person is staffed on or delivery-manages. */
  projects: StaffProjectSummary[];
  /** This person's Manual of Me answers, in question order (unanswered → null). */
  manualOfMe: ManualOfMeEntry[];
  /** This person's Ways of Working survey answers (keyed by question id). */
  waysOfWorking: WaysOfWorking;
  history: HistoryEntry[];
  /** Null when the viewer isn't allowed to see this person's PTO (pto.review). */
  pto: StaffPtoView | null;
  /** Whether the viewer may edit this profile (own profile, or `staff.edit`). */
  canEdit: boolean;
  /** Whether the viewer may see this person's compensation (own, or `staff.viewCompensation`). */
  canViewCompensation: boolean;
}) {
  const { employment } = profile;
  const initials = initialsFor(profile.name, profile.email);
  const manualOfMeAnswered = manualOfMe.filter(
    (entry) => entry.textResponse !== null,
  ).length;
  const waysOfWorkingAnswered = waysOfWorking.answeredCount;

  const employmentSummary = employment
    ? [
        ROLE_LABELS[employment.role],
        LINE_OF_BUSINESS_LABELS[employment.lineOfBusiness],
        EMPLOYMENT_TYPE_LABELS[employment.employmentType],
        employment.isBillable ? "Billable" : "Non-billable",
      ].join(" · ")
    : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
      {/* Left rail: identity, links, compensation. */}
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Avatar className="size-14">
                {imageUrl ? (
                  <AvatarImage src={imageUrl} alt={profile.name} />
                ) : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-0.5">
                <h2 className="font-heading text-xl font-semibold tracking-tight">
                  {profile.name}
                </h2>
                {employmentSummary ? (
                  <span className="text-sm text-muted-foreground">
                    {employmentSummary}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <MetaRow label="Email">{profile.email}</MetaRow>
              {profile.joinDate ? (
                <MetaRow label="Joined">{formatDate(profile.joinDate)}</MetaRow>
              ) : null}
              {profile.managerId ? (
                <MetaRow label="Reports to">
                  <Link
                    href={`/staff/${profile.managerId}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {profile.managerName}
                  </Link>
                </MetaRow>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
            {canEdit ? (
              <CardAction>
                <EditLinksDialog
                  staffId={staffId}
                  links={{
                    linkedinUrl: profile.linkedinUrl,
                    githubUrl: profile.githubUrl,
                    portfolioUrl: profile.portfolioUrl,
                  }}
                />
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <LinkRow label="LinkedIn" url={profile.linkedinUrl} />
            <LinkRow label="GitHub" url={profile.githubUrl} />
            <LinkRow label="Portfolio" url={profile.portfolioUrl} />
          </CardContent>
        </Card>

        {canViewCompensation ? (
          <Card>
            <CardHeader>
              <CardTitle>Compensation</CardTitle>
            </CardHeader>
            <CardContent>
              <CompensationSection
                base={employment?.base ?? null}
                hourlyRate={employment?.hourlyRate ?? null}
                guaranteedBonus={employment?.guaranteedBonus ?? null}
                discretionaryBonus={employment?.discretionaryBonus ?? null}
                currency={employment?.currency ?? null}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Right column: tabbed detail. */}
      <Card>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList variant="line" className="mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="manual-of-me">Manual of Me</TabsTrigger>
              <TabsTrigger value="ways-of-working">Ways of Working</TabsTrigger>
              <TabsTrigger value="resume">Resume</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent
              value="overview"
              className="flex flex-col [&>section:not(:first-child)]:mt-8 [&>section:not(:first-child)]:border-t [&>section:not(:first-child)]:border-border [&>section:not(:first-child)]:pt-8"
            >
              <TabSection
                title="Skills"
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/staff/${staffId}/skills`} />}
                    >
                      <IconPencil />
                      Edit
                    </Button>
                  ) : undefined
                }
              >
                <SkillsSection skills={profile.skills} />
              </TabSection>

              <TabSection
                title="Client intro"
                action={
                  canEdit ? (
                    <EditClientIntroDialog
                      staffId={staffId}
                      clientIntro={profile.clientIntro}
                    />
                  ) : undefined
                }
              >
                {profile.clientIntro ? (
                  <p className="text-sm whitespace-pre-wrap">
                    {profile.clientIntro}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No client intro yet.
                  </p>
                )}
              </TabSection>

              <TabSection title="Projects">
                <StaffProjectsSection projects={projects} />
              </TabSection>

              {pto ? (
                <TabSection
                  title="Time off"
                  action={
                    // A real anchor, not <Button render={<a>}>: this navigates
                    // to an external page, so it's a link, not a role="button".
                    <a
                      href={RIPPLING_TIME_OFF_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      Manage
                      <IconExternalLink />
                    </a>
                  }
                >
                  <PtoContent pto={pto} />
                </TabSection>
              ) : null}
            </TabsContent>

            <TabsContent value="manual-of-me">
              <TabSection
                title="Manual of Me"
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/staff/${staffId}/manual-of-me`} />}
                    >
                      <IconPencil />
                      {manualOfMeAnswered > 0 ? "Edit" : "Fill out"}
                    </Button>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-3">
                  <ManualOfMeSection entries={manualOfMe} />
                  {manualOfMeAnswered > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {manualOfMeAnswered} of {manualOfMe.length} answered
                    </p>
                  ) : null}
                </div>
              </TabSection>
            </TabsContent>

            <TabsContent value="ways-of-working">
              <TabSection
                title="Ways of Working"
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link href={`/staff/${staffId}/ways-of-working`} />
                      }
                    >
                      <IconPencil />
                      {waysOfWorkingAnswered > 0 ? "Edit" : "Fill out"}
                    </Button>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-3">
                  <WaysOfWorkingSection responses={waysOfWorking} />
                  {waysOfWorkingAnswered > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {waysOfWorkingAnswered} of {waysOfWorking.totalCount}{" "}
                      answered
                    </p>
                  ) : null}
                </div>
              </TabSection>
            </TabsContent>

            <TabsContent value="resume">
              <TabSection
                title="Resume"
                action={
                  <EditResumeDialog staffId={staffId} resume={profile.resume} />
                }
              >
                {profile.resume ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm whitespace-pre-wrap">
                      {profile.resume}
                    </p>
                    {profile.resumeUpdatedAt ? (
                      <p className="text-xs text-muted-foreground">
                        Updated {formatTimestamp(profile.resumeUpdatedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No resume yet.
                  </p>
                )}
              </TabSection>
            </TabsContent>

            <TabsContent value="history">
              <TabSection title="History">
                <HistoryTimeline entries={history} />
              </TabSection>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
