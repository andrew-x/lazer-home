import type { MyProfile } from "@/actions/staff/getMyProfile";
import type { HistoryEntry } from "@/actions/staff/getStaffHistory";
import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { EditClientIntroDialog } from "@/components/staff/edit-client-intro-dialog";
import { EditLinksDialog } from "@/components/staff/edit-links-dialog";
import { HistorySheet } from "@/components/staff/history-sheet";
import { PtoSection } from "@/components/staff/pto-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, humanizeEnum } from "@/lib/format";

/** Up to two initials from a name, falling back to the email's first letter. */
function initialsFor(name: string, email: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") ||
    email[0] ||
    "?"
  ).toUpperCase();
}

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
          className="text-right font-medium text-primary underline-offset-4 hover:underline"
        >
          {url}
        </a>
      ) : (
        <span className="font-medium text-muted-foreground">—</span>
      )}
    </div>
  );
}

/**
 * Read view of a staff member's profile: identity header, links, client intro,
 * time off, and history. Links and intro are editable by any signed-in user for
 * now (see the browse-staff spec). Shared by `/profile` (self) and `/staff/[id]`.
 */
export function ProfileView({
  staffId,
  imageUrl,
  profile,
  history,
  pto,
}: {
  staffId: string;
  imageUrl: string | null;
  profile: MyProfile;
  history: HistoryEntry[];
  pto: StaffPtoView;
}) {
  const { employment } = profile;
  const initials = initialsFor(profile.name, profile.email);

  const employmentSummary = employment
    ? [
        humanizeEnum(employment.role),
        humanizeEnum(employment.lineOfBusiness),
        humanizeEnum(employment.employmentType),
      ].join(" · ")
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex items-center gap-4">
        <Avatar className="size-12">
          {imageUrl ? <AvatarImage src={imageUrl} alt={profile.name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              {profile.name}
            </h2>
            {employment ? (
              <Badge variant={employment.isBillable ? "default" : "secondary"}>
                {employment.isBillable ? "Billable" : "Non-billable"}
              </Badge>
            ) : null}
          </div>
          {employmentSummary ? (
            <span className="text-sm text-muted-foreground">
              {employmentSummary}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">
            {profile.email}
            {profile.joinDate
              ? ` · Joined ${formatDate(profile.joinDate)}`
              : ""}
          </span>
        </div>
        <div className="ml-auto self-start">
          <HistorySheet entries={history} />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
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
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <LinkRow label="LinkedIn" url={profile.linkedinUrl} />
          <LinkRow label="GitHub" url={profile.githubUrl} />
          <LinkRow label="Portfolio" url={profile.portfolioUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client intro</CardTitle>
          <CardAction>
            <EditClientIntroDialog
              staffId={staffId}
              clientIntro={profile.clientIntro}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {profile.clientIntro ? (
            <p className="text-sm whitespace-pre-wrap">{profile.clientIntro}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No client intro yet.
            </p>
          )}
        </CardContent>
      </Card>

      <PtoSection pto={pto} />
    </div>
  );
}
