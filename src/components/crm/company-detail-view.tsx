import { IconBuilding } from "@tabler/icons-react";
import type { CompanyDetail } from "@/actions/crm/getCompanyDetail";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import { InternalLink } from "@/components/internal-link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanizeEnum } from "@/lib/format";
import { TabLabel, TableEmpty } from "./detail-parts";
import { EditCompanyDialog } from "./edit-company-dialog";
import { InlineOwnerField } from "./inline-owner-field";
import { OpportunityStatusBadge } from "./opportunity-status-badge";

/**
 * Read view of a company: an identity header plus tabs for everything that
 * hangs off it — pipeline opportunities, delivery projects, and the people who
 * work there. Contacts link through to their own detail page (the company's
 * people directory); opportunities and projects have no detail page yet, so
 * they render as plain rows.
 */
export function CompanyDetailView({
  company,
  canEdit,
}: {
  company: CompanyDetail;
  canEdit: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-start gap-4">
        <span className="flex size-12 items-center justify-center rounded-md border bg-muted text-muted-foreground">
          <IconBuilding className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              {company.name}
            </h2>
            {company.isPartner ? (
              <Badge variant="secondary">Partner</Badge>
            ) : null}
          </div>
          {company.websiteUrl ? (
            <ExternalLink href={company.websiteUrl} className="text-sm">
              {company.websiteUrl.replace(/^https?:\/\//, "")}
            </ExternalLink>
          ) : (
            <span className="text-sm text-muted-foreground">No website</span>
          )}
          <div className="mt-1 max-w-xs">
            <InlineOwnerField
              kind="company"
              entityId={company.id}
              canEdit={canEdit}
              ownerId={company.ownerId}
              ownerName={company.ownerName}
            />
          </div>
        </div>
        {canEdit ? (
          <div className="ml-auto">
            <EditCompanyDialog company={company} />
          </div>
        ) : null}
      </header>

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">
            <TabLabel
              label="Opportunities"
              count={company.opportunities.length}
            />
          </TabsTrigger>
          <TabsTrigger value="projects">
            <TabLabel label="Projects" count={company.projects.length} />
          </TabsTrigger>
          <TabsTrigger value="contacts">
            <TabLabel label="Contacts" count={company.contacts.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities">
          <div className="rounded-md border">
            {company.opportunities.length === 0 ? (
              <TableEmpty>No opportunities for this company yet.</TableEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
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
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="projects">
          <div className="rounded-md border">
            {company.projects.length === 0 ? (
              <TableEmpty>No projects for this company yet.</TableEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">
                        {project.name}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contacts">
          <div className="rounded-md border">
            {company.contacts.length === 0 ? (
              <TableEmpty>No contacts at this company yet.</TableEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">
                        <InternalLink href={`/contacts/${contact.id}`}>
                          {contact.name}
                        </InternalLink>
                      </TableCell>
                      <TableCell>{contact.role ?? <EmptyCell />}</TableCell>
                      <TableCell>
                        <a
                          href={`mailto:${contact.email}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {contact.email}
                        </a>
                      </TableCell>
                      <TableCell>
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {contact.phone}
                          </a>
                        ) : (
                          <EmptyCell />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
