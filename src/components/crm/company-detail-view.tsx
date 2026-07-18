import { IconBuilding } from "@tabler/icons-react";
import { Fragment } from "react";
import type { CompanyDetail } from "@/actions/crm/getCompanyDetail";
import { MailLink, PhoneLink } from "@/components/contact-link";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { humanizeEnum } from "@/lib/format";
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
 * owner) beside stacked sections for everything that hangs off it — pipeline
 * opportunities, delivery projects, and the people who work there. Contacts link
 * through to their own detail page (the company's people directory);
 * opportunities and projects have no detail page yet, so they render as rows.
 */
export function CompanyDetailView({
  company,
  canEdit,
}: {
  company: CompanyDetail;
  canEdit: boolean;
}) {
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
                <TableCell className="font-medium">{project.name}</TableCell>
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
                <TableCell className="font-medium">{project.name}</TableCell>
                <TableCell>
                  <InternalLink href={`/companies/${project.clientCompanyId}`}>
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

      <DetailSection title="Contacts" count={company.contacts.length}>
        {company.contacts.length === 0 ? (
          <TableEmpty>No contacts at this company yet.</TableEmpty>
        ) : (
          <DetailTable headers={["Name", "Role", "Email", "Phone"]}>
            {company.contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">
                  <InternalLink href={`/contacts/${contact.id}`}>
                    {contact.name}
                  </InternalLink>
                </TableCell>
                <TableCell>{contact.role ?? <EmptyCell />}</TableCell>
                <TableCell>
                  <MailLink email={contact.email} />
                </TableCell>
                <TableCell>
                  {contact.phone ? (
                    <PhoneLink phone={contact.phone} />
                  ) : (
                    <EmptyCell />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </DetailTable>
        )}
      </DetailSection>
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
