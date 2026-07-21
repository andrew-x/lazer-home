import { IconBuilding } from "@tabler/icons-react";
import { Fragment } from "react";
import type { CompanyDetail } from "@/actions/crm/getCompanyDetail";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanizeEnum } from "@/lib/format";
import { ContactNextStepCell } from "./contact-next-step-cell";
import {
  DetailIdentity,
  DetailLayout,
  DetailSection,
  DetailTable,
  MetaField,
  SidebarSection,
  TableEmpty,
} from "./detail-parts";
import { EditCompanyDialog } from "./edit-company-dialog";
import { InlineOwnerField } from "./inline-owner-field";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

/**
 * Read view of a company: a meta sidebar (identity, website, and the inline
 * owner) beside two tabs — Contacts (the company's people directory, linking
 * through to each contact's detail page) and Opportunities & Projects (its
 * pipeline, delivery work, and referred deals/projects). Opportunities and
 * projects have no detail page yet, so they render as rows.
 */
export function CompanyDetailView({
  company,
  canEdit,
}: {
  company: CompanyDetail;
  canEdit: boolean;
}) {
  const hasPipeline =
    company.opportunities.length > 0 ||
    company.projects.length > 0 ||
    company.referredOpportunities.length > 0 ||
    company.referredProjects.length > 0;

  return (
    <DetailLayout
      sidebar={
        <>
          <DetailIdentity
            media={
              <span className="flex size-12 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <IconBuilding className="size-6" />
              </span>
            }
            title={
              <>
                <h2 className="font-heading text-lg font-semibold tracking-tight">
                  {company.name}
                </h2>
                {company.isPartner ? (
                  <Badge variant="secondary">Partner</Badge>
                ) : null}
              </>
            }
            action={canEdit ? <EditCompanyDialog company={company} /> : null}
          />

          <SidebarSection>
            <MetaField label="Website">
              {company.websiteUrl ? (
                <ExternalLink href={company.websiteUrl}>
                  {company.websiteUrl.replace(/^https?:\/\//, "")}
                </ExternalLink>
              ) : null}
            </MetaField>
          </SidebarSection>

          <SidebarSection>
            <InlineOwnerField
              kind="company"
              entityId={company.id}
              canEdit={canEdit}
              ownerId={company.ownerId}
              ownerName={company.ownerName}
            />
          </SidebarSection>
        </>
      }
    >
      <Tabs defaultValue="contacts">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="pipeline">
            Opportunities &amp; Projects
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <DetailSection title="Contacts" count={company.contacts.length}>
            {company.contacts.length === 0 ? (
              <TableEmpty>No contacts at this company yet.</TableEmpty>
            ) : (
              <DetailTable headers={["Name", "Role", "Next steps"]}>
                {company.contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">
                      <InternalLink href={`/contacts/${contact.id}`}>
                        {contact.name}
                      </InternalLink>
                    </TableCell>
                    <TableCell>{contact.role ?? <EmptyCell />}</TableCell>
                    <TableCell>
                      <ContactNextStepCell
                        nextStep={contact.nextStep}
                        nextStepAt={contact.nextStepAt}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </DetailTable>
            )}
          </DetailSection>
        </TabsContent>

        <TabsContent value="pipeline" className="flex flex-col gap-8">
          {hasPipeline ? null : (
            <TableEmpty>
              Nothing in the pipeline for this company yet.
            </TableEmpty>
          )}

          {company.opportunities.length > 0 && (
            <DetailSection
              title="Opportunities"
              count={company.opportunities.length}
            >
              <DetailTable headers={["Name", "Stage", "Source"]}>
                {company.opportunities.map((opportunity) => (
                  <TableRow key={opportunity.id}>
                    <TableCell className="font-medium">
                      {opportunity.name}
                    </TableCell>
                    <TableCell>
                      <OpportunityStatusBadge status={opportunity.status} />
                    </TableCell>
                    <TableCell>{humanizeEnum(opportunity.source)}</TableCell>
                  </TableRow>
                ))}
              </DetailTable>
            </DetailSection>
          )}

          {company.projects.length > 0 && (
            <DetailSection title="Projects" count={company.projects.length}>
              <DetailTable headers={["Name"]}>
                {company.projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">
                      {project.name}
                    </TableCell>
                  </TableRow>
                ))}
              </DetailTable>
            </DetailSection>
          )}

          {company.referredOpportunities.length > 0 && (
            <DetailSection
              title="Referred opportunities"
              count={company.referredOpportunities.length}
            >
              <DetailTable
                headers={["Opportunity", "Client", "Stage", "Referred by"]}
              >
                {company.referredOpportunities.map((opportunity) => (
                  <TableRow key={opportunity.id}>
                    <TableCell className="font-medium">
                      {opportunity.name}
                    </TableCell>
                    <TableCell>
                      <InternalLink
                        href={`/companies/${opportunity.clientCompanyId}`}
                      >
                        {opportunity.clientCompanyName}
                      </InternalLink>
                    </TableCell>
                    <TableCell>
                      <OpportunityStatusBadge status={opportunity.status} />
                    </TableCell>
                    <TableCell>
                      <ReferrerLinks referrers={opportunity.referrers} />
                    </TableCell>
                  </TableRow>
                ))}
              </DetailTable>
            </DetailSection>
          )}

          {company.referredProjects.length > 0 && (
            <DetailSection
              title="Referred projects"
              count={company.referredProjects.length}
            >
              <DetailTable headers={["Project", "Client", "Referred by"]}>
                {company.referredProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">
                      {project.name}
                    </TableCell>
                    <TableCell>
                      <InternalLink
                        href={`/companies/${project.clientCompanyId}`}
                      >
                        {project.clientCompanyName}
                      </InternalLink>
                    </TableCell>
                    <TableCell>
                      <ReferrerLinks referrers={project.referrers} />
                    </TableCell>
                  </TableRow>
                ))}
              </DetailTable>
            </DetailSection>
          )}
        </TabsContent>
      </Tabs>
    </DetailLayout>
  );
}

/** The "Referred by" cell: the referring contacts, each linked, comma-separated. */
function ReferrerLinks({
  referrers,
}: {
  referrers: { id: string; name: string }[];
}) {
  return (
    <>
      {referrers.map((referrer, index) => (
        <Fragment key={referrer.id}>
          {index > 0 ? ", " : null}
          <InternalLink href={`/contacts/${referrer.id}`}>
            {referrer.name}
          </InternalLink>
        </Fragment>
      ))}
    </>
  );
}
