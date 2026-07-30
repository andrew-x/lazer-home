import type {
  ContactDetail,
  ContactOpportunity,
  ContactProject,
} from "@/actions/crm/getContactDetail";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InternalLink } from "@/components/internal-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contactName } from "@/lib/crm/contact-name";
import { INACTIVE_LABEL } from "@/lib/crm/contact-status";
import { humanizeEnum, initialsFor } from "@/lib/format/format";
import { ContactRelationshipsSection } from "./contact-relationships-section";
import {
  DetailIdentity,
  DetailLayout,
  DetailSection,
  DetailTable,
  SidebarSection,
  TableEmpty,
} from "./detail-parts";
import { EditContactDialog } from "./edit-contact-dialog";
import { EntryLog } from "./entry-log";
import { InlineContactCompanyField } from "./inline-contact-company-field";
import {
  InlineContactEmailField,
  InlineContactLinkedinField,
  InlineContactPhoneField,
} from "./inline-contact-text-fields";
import { InlineLocationField } from "./inline-location-field";
import { InlineOwnerField } from "./inline-owner-field";
import { InlineRelationshipStrengthField } from "./inline-relationship-strength-field";
import { OpportunityStatusBadge } from "./opportunity-status-badge";
import { RelatedCompaniesSection } from "./related-companies-section";
import { TaskList } from "./task-list";

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
          <TableCell className="font-medium">
            <InternalLink href={`/projects/${project.id}`}>
              {project.name}
            </InternalLink>
          </TableCell>
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
 * location, the Relationships group, relationship-strength rating and owner) beside
 * three tabs — Activity (tasks + notes), Companies, and Opportunities.
 *
 * Every sidebar row below the identity block is **editable in place** — the pencil
 * turns that one row into a control and saves just it, through
 * `updateContactField`. The `EditContactDialog` is left with the identity block
 * (names, job title, status): the things you'd change as one deliberate edit, not
 * the ones you fix in passing. That split is why the dialog no longer round-trips
 * hidden defaults — a scoped save can't clobber a value changed inline while it sat
 * open.
 *
 * Every person-to-person link — manager included — lives in the sidebar's
 * Relationships group, which is also the only place they're added or removed; the
 * contact form deliberately has no manager picker. An inactive record whose person has
 * a newer record elsewhere says so right under the name, because that page is a
 * dead end and "where did they go" is the only question worth answering there.
 *
 * Companies sits in the middle, mirroring the company page's
 * people-before-pipeline order: it lists the companies they're linked to *without*
 * working there (their employer stays in the sidebar). The Opportunities section
 * separates deals they referred from ones they're merely involved in; the Projects
 * section shows work that grew out of the deals they referred (contacts don't
 * attach to projects directly).
 */
export function ContactDetailView({
  contact,
  canEdit,
  currentStaff,
}: {
  contact: ContactDetail;
  canEdit: boolean;
  currentStaff: EntityOption | null;
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
              <>
                <h2 className="font-heading text-lg font-semibold tracking-tight">
                  {name}
                </h2>
                {contact.isActive ? null : (
                  <Badge variant="secondary">{INACTIVE_LABEL}</Badge>
                )}
              </>
            }
            subtitle={
              <>
                {contact.role}
                {/* An inactive record with a successor is a dead end someone reached
                    by accident — a stale link, an old note. Their only question is
                    "where did they go", so the answer sits here rather than four
                    sidebar sections down. The reverse case (a current record with a
                    predecessor) gets nothing extra: you're already in the right
                    place, and the history is context, not a redirect. */}
                {contact.successor ? (
                  <div>
                    Moved to{" "}
                    <InternalLink href={`/contacts/${contact.successor.id}`}>
                      {contact.successor.name}
                    </InternalLink>
                    {contact.successor.companyName
                      ? ` at ${contact.successor.companyName}`
                      : null}
                  </div>
                ) : null}
              </>
            }
            action={canEdit ? <EditContactDialog contact={contact} /> : null}
          />

          {/* Every "how and where to reach them" fact, each editable in place. They
              read as the same links they always did and only become inputs on the
              pencil, so the block stays scannable. Location sits with them rather
              than in a section of its own — it's the same kind of fact, and it reads
              as one block with Company above it. */}
          <SidebarSection>
            <InlineContactEmailField
              contactId={contact.id}
              canEdit={canEdit}
              email={contact.email}
            />
            <InlineContactPhoneField
              contactId={contact.id}
              canEdit={canEdit}
              phone={contact.phone}
            />
            <InlineContactLinkedinField
              contactId={contact.id}
              canEdit={canEdit}
              linkedinUrl={contact.linkedinUrl}
            />
            <InlineContactCompanyField
              contactId={contact.id}
              canEdit={canEdit}
              companyId={contact.companyId}
              companyName={contact.companyName}
              hasManager={contact.manager !== null}
            />
            <InlineLocationField
              kind="contact"
              entityId={contact.id}
              canEdit={canEdit}
              location={contact.location}
            />
          </SidebarSection>

          {/* Where the read-only "Manager" field used to be — management is now
              one kind of relationship among several, all managed here. */}
          <SidebarSection>
            <ContactRelationshipsSection
              contactId={contact.id}
              contactName={name}
              employerCompanyId={contact.companyId}
              manager={contact.manager}
              directReports={contact.directReports}
              predecessor={contact.predecessor}
              successor={contact.successor}
              relatedContacts={contact.relatedContacts}
              canEdit={canEdit}
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
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex flex-col gap-12">
          <DetailSection title="Next steps" count={contact.tasks.length}>
            <TaskList
              variant="contact"
              parentId={contact.id}
              tasks={contact.tasks}
              canEdit={canEdit}
              currentStaff={currentStaff}
            />
          </DetailSection>

          <DetailSection title="Notes" count={contact.notes.length}>
            <EntryLog
              variant="contact"
              parentId={contact.id}
              entries={contact.notes}
              canEdit={canEdit}
            />
          </DetailSection>
        </TabsContent>

        <TabsContent value="companies">
          <RelatedCompaniesSection
            contactId={contact.id}
            employerCompanyId={contact.companyId}
            rows={contact.relatedCompanies}
            canEdit={canEdit}
          />
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
