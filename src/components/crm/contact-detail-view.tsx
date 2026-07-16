import type {
  ContactDetail,
  ContactOpportunity,
  ContactProject,
} from "@/actions/crm/getContactDetail";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactName } from "@/lib/contact-name";
import { humanizeEnum, initialsFor } from "@/lib/format";
import {
  DetailIdentity,
  DetailLayout,
  DetailSection,
  MetaField,
  SidebarSection,
  TableEmpty,
} from "./detail-parts";
import { EditContactDialog } from "./edit-contact-dialog";
import { InlineOwnerField } from "./inline-owner-field";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

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

/**
 * A labelled opportunity subgroup within the Opportunities section: a small
 * sub-heading, then the table or an empty note. Nested under the section
 * heading, so it reads as a quieter sub-label rather than a peer title.
 */
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
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
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
 * Read view of a contact: a meta sidebar (identity, contact methods, employer,
 * manager — all optional — and the inline owner) beside stacked sections for
 * their CRM footprint. The Opportunities section separates deals they referred
 * from ones they're merely involved in; the Projects section shows work that
 * grew out of the deals they referred (contacts don't attach to projects
 * directly).
 */
export function ContactDetailView({
  contact,
  canEdit,
}: {
  contact: ContactDetail;
  canEdit: boolean;
}) {
  const name = contactName(contact);
  const opportunityCount =
    contact.referredOpportunities.length + contact.involvedOpportunities.length;

  return (
    <DetailLayout
      sidebar={
        <>
          <DetailIdentity
            media={
              <Avatar className="size-12">
                <AvatarFallback>
                  {initialsFor(name, contact.email)}
                </AvatarFallback>
              </Avatar>
            }
            title={
              <h2 className="font-heading text-lg font-semibold tracking-tight">
                {name}
              </h2>
            }
            subtitle={contact.role}
            action={canEdit ? <EditContactDialog contact={contact} /> : null}
          />

          <SidebarSection>
            <MetaField label="Email">
              <a
                href={`mailto:${contact.email}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {contact.email}
              </a>
            </MetaField>
            <MetaField label="Phone">
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {contact.phone}
                </a>
              ) : null}
            </MetaField>
            <MetaField label="LinkedIn">
              {contact.linkedinUrl ? (
                <ExternalLink href={contact.linkedinUrl}>Profile</ExternalLink>
              ) : null}
            </MetaField>
            <MetaField label="Company">
              {contact.companyId && contact.companyName ? (
                <InternalLink href={`/companies/${contact.companyId}`}>
                  {contact.companyName}
                </InternalLink>
              ) : null}
            </MetaField>
            <MetaField label="Manager">
              {contact.managerId && contact.managerName ? (
                <InternalLink href={`/contacts/${contact.managerId}`}>
                  {contact.managerName}
                </InternalLink>
              ) : null}
            </MetaField>
          </SidebarSection>

          <SidebarSection>
            <InlineOwnerField
              kind="contact"
              entityId={contact.id}
              canEdit={canEdit}
              ownerId={contact.ownerId}
              ownerName={contact.ownerName}
            />
          </SidebarSection>
        </>
      }
    >
      <DetailSection title="Opportunities" count={opportunityCount}>
        <div className="flex flex-col gap-5">
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
        </div>
      </DetailSection>

      <DetailSection title="Projects" count={contact.referredProjects.length}>
        {contact.referredProjects.length === 0 ? (
          <div className="rounded-md border">
            <TableEmpty>
              No projects yet from the opportunities this contact referred.
            </TableEmpty>
          </div>
        ) : (
          <ProjectTable rows={contact.referredProjects} />
        )}
      </DetailSection>
    </DetailLayout>
  );
}
