import type { ReactNode } from "react";
import type {
  ContactDetail,
  ContactOpportunity,
  ContactProject,
} from "@/actions/crm/getContactDetail";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanizeEnum, initialsFor } from "@/lib/format";
import { TabLabel, TableEmpty } from "./detail-parts";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

/** A label/value row in the details card; falls back to an em dash when empty. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right font-medium">
        {children ?? <EmptyCell />}
      </span>
    </div>
  );
}

/** Opportunities as a table; each names and links through to its company. */
function OpportunityTable({ rows }: { rows: ContactOpportunity[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((opportunity) => (
            <TableRow key={opportunity.id}>
              <TableCell className="font-medium">{opportunity.name}</TableCell>
              <TableCell>
                <InternalLink href={`/companies/${opportunity.companyId}`}>
                  {opportunity.companyName}
                </InternalLink>
              </TableCell>
              <TableCell>
                <OpportunityStatusBadge status={opportunity.status} />
              </TableCell>
              <TableCell>{humanizeEnum(opportunity.source)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A labelled opportunity group: heading, then the table or an empty note. */
function OpportunityGroup({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: ContactOpportunity[];
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-heading text-base font-semibold tracking-tight">
        {title}
      </h3>
      {rows.length === 0 ? (
        <div className="rounded-md border">
          <TableEmpty>{empty}</TableEmpty>
        </div>
      ) : (
        <OpportunityTable rows={rows} />
      )}
    </section>
  );
}

/** Projects (derived from referred opportunities), each linking its company. */
function ProjectTable({ rows }: { rows: ContactProject[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((project) => (
            <TableRow key={project.id}>
              <TableCell className="font-medium">{project.name}</TableCell>
              <TableCell>
                <InternalLink href={`/companies/${project.companyId}`}>
                  {project.companyName}
                </InternalLink>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Read view of a contact: an identity header, a details card (contact methods,
 * employer, manager — all optional), and tabs for their CRM footprint. The
 * Opportunities tab separates deals they referred from ones they're merely
 * involved in; the Projects tab shows work that grew out of the deals they
 * referred (contacts don't attach to projects directly).
 */
export function ContactDetailView({ contact }: { contact: ContactDetail }) {
  const name = `${contact.firstName} ${contact.lastName}`;
  const opportunityCount =
    contact.referredOpportunities.length + contact.involvedOpportunities.length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-center gap-4">
        <Avatar className="size-12">
          <AvatarFallback>{initialsFor(name, contact.email)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {name}
          </h2>
          {contact.role ? (
            <span className="text-sm text-muted-foreground">
              {contact.role}
            </span>
          ) : null}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <DetailRow label="Email">
            <a
              href={`mailto:${contact.email}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {contact.email}
            </a>
          </DetailRow>
          <DetailRow label="Phone">
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {contact.phone}
              </a>
            ) : null}
          </DetailRow>
          <DetailRow label="LinkedIn">
            {contact.linkedinUrl ? (
              <ExternalLink href={contact.linkedinUrl}>Profile</ExternalLink>
            ) : null}
          </DetailRow>
          <DetailRow label="Company">
            {contact.companyId && contact.companyName ? (
              <InternalLink href={`/companies/${contact.companyId}`}>
                {contact.companyName}
              </InternalLink>
            ) : null}
          </DetailRow>
          <DetailRow label="Manager">
            {contact.managerId && contact.managerName ? (
              <InternalLink href={`/contacts/${contact.managerId}`}>
                {contact.managerName}
              </InternalLink>
            ) : null}
          </DetailRow>
        </CardContent>
      </Card>

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">
            <TabLabel label="Opportunities" count={opportunityCount} />
          </TabsTrigger>
          <TabsTrigger value="projects">
            <TabLabel
              label="Projects"
              count={contact.referredProjects.length}
            />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="flex flex-col gap-6">
          <OpportunityGroup
            title="Referred by this contact"
            rows={contact.referredOpportunities}
            empty="This contact hasn't referred any opportunities."
          />
          <OpportunityGroup
            title="Also involved in"
            rows={contact.involvedOpportunities}
            empty="Not named on any other opportunities."
          />
        </TabsContent>

        <TabsContent value="projects">
          {contact.referredProjects.length === 0 ? (
            <div className="rounded-md border">
              <TableEmpty>
                No projects yet from the opportunities this contact referred.
              </TableEmpty>
            </div>
          ) : (
            <ProjectTable rows={contact.referredProjects} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
