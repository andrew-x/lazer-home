import type {
  ContactDetail,
  ContactOpportunity,
  ContactProject,
} from "@/actions/crm/getContactDetail";
import { MailLink, PhoneLink } from "@/components/contact-link";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contactName } from "@/lib/crm/contact-name";
import { humanizeEnum, initialsFor } from "@/lib/format/format";
import {
  DetailIdentity,
  DetailLayout,
  DetailSection,
  DetailTable,
  MetaField,
  SidebarSection,
  TableEmpty,
} from "./detail-parts";
import { EditContactDialog } from "./edit-contact-dialog";
import { EntryLog } from "./entry-log";
import { InlineLocationField } from "./inline-location-field";
import { InlineOwnerField } from "./inline-owner-field";
import { InlineRelationshipStrengthField } from "./inline-relationship-strength-field";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

/** Opportunities as a table; each names and links through to its company. */
function OpportunityTable({ rows }: { rows: ContactOpportunity[] }) {
  return (
    <DetailTable headers={["Name", "Company", "Stage", "Source"]}>
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
    </DetailTable>
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
        <TableEmpty>{empty}</TableEmpty>
      ) : (
        <OpportunityTable rows={rows} />
      )}
    </section>
  );
}

/** Projects (derived from referred opportunities), each linking its company. */
function ProjectTable({ rows }: { rows: ContactProject[] }) {
  return (
    <DetailTable headers={["Name", "Company"]}>
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
    </DetailTable>
  );
}

/**
 * Read view of a contact: a meta sidebar (identity, contact methods, employer,
 * manager — all optional — plus the inline relationship-strength rating and
 * owner) beside two tabs — Activity (next steps + notes) and Opportunities. The
 * Opportunities section separates deals they referred from ones they're merely
 * involved in; the Projects section shows work that grew out of the deals they
 * referred (contacts don't attach to projects directly).
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
              <MailLink email={contact.email} />
            </MetaField>
            <MetaField label="Phone">
              {contact.phone ? <PhoneLink phone={contact.phone} /> : null}
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
            <InlineLocationField
              kind="contact"
              entityId={contact.id}
              canEdit={canEdit}
              location={contact.location}
            />
          </SidebarSection>

          <SidebarSection>
            <InlineRelationshipStrengthField
              contactId={contact.id}
              canEdit={canEdit}
              strength={contact.relationshipStrength}
            />
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
      <Tabs defaultValue="activity">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex flex-col gap-12">
          <DetailSection title="Next steps" count={contact.nextSteps.length}>
            <EntryLog
              variant="contact"
              parentId={contact.id}
              kind="next_step"
              entries={contact.nextSteps}
              canEdit={canEdit}
            />
          </DetailSection>

          <DetailSection title="Notes" count={contact.notes.length}>
            <EntryLog
              variant="contact"
              parentId={contact.id}
              kind="note"
              entries={contact.notes}
              canEdit={canEdit}
            />
          </DetailSection>
        </TabsContent>

        <TabsContent value="opportunities" className="flex flex-col gap-8">
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

          <DetailSection
            title="Projects"
            count={contact.referredProjects.length}
          >
            {contact.referredProjects.length === 0 ? (
              <TableEmpty>
                No projects yet from the opportunities this contact referred.
              </TableEmpty>
            ) : (
              <ProjectTable rows={contact.referredProjects} />
            )}
          </DetailSection>
        </TabsContent>
      </Tabs>
    </DetailLayout>
  );
}
