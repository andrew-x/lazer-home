import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { contactName } from "@/lib/crm/contact-name";
import type { ContactRelationshipKind } from "@/lib/crm/contact-relationship";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import {
  companies,
  companyContactRelationships,
  contactRelationships,
  contacts,
  opportunities,
  opportunityContacts,
  opportunitySourceContacts,
  projects,
  staff,
} from "@/lib/db/schema";
import type { EntryView } from "./entryViews";
import { getContactEntries } from "./entryViews";
import { getTasksForParent, type TaskView } from "./getTasks";

export type ContactOpportunity = {
  id: string;
  name: string;
  status: OpportunityStatus;
  source: OpportunitySource;
  companyId: string;
  companyName: string;
};

export type ContactProject = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
};

/**
 * A company this contact is linked to without working there — the mirror of
 * `CompanyRelatedContact`. Their employer stays on `ContactDetail.companyId`;
 * these are the other companies they touch (a client they're the CSM for, a
 * former employer, one they invest in). `description` is the free-text label.
 */
export type ContactRelatedCompany = {
  /** The link row's id — the handle for editing or removing the relationship. */
  relationshipId: string;
  id: string;
  name: string;
  isPartner: boolean;
  description: string;
};

/**
 * The contact on the other side of a `contact_relationships` row, resolved from
 * whichever end the viewed contact isn't on. One type serves all five groups —
 * the group it lands in is what carries the direction, so no row needs to.
 */
export type ContactRelation = {
  /** The link row's id — the handle for editing or removing the relationship. */
  relationshipId: string;
  kind: ContactRelationshipKind;
  id: string;
  name: string;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  /** False for an inactive contact — a `succeeds` predecessor always is. */
  isActive: boolean;
  /** Free text; non-null only for `related`. */
  description: string | null;
};

export type ContactDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string | null;
  linkedinUrl: string | null;
  location: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  /** How strong our relationship is, 1–5, or null when unrated. */
  relationshipStrength: number | null;
  /** False once they're inactive — drives the "Inactive" badge. */
  isActive: boolean;
  /** Who they report to — at most one, at the same company. Null when unset. */
  manager: ContactRelation | null;
  /** Who reports to them — the reverse of `manager`, new with the junction. */
  directReports: ContactRelation[];
  /** Their earlier record at a previous employer. Null when none. */
  predecessor: ContactRelation | null;
  /** Their later record at a newer employer. Null when none. */
  successor: ContactRelation | null;
  /** Symmetric free-text links, from either direction, ordered by name. */
  relatedContacts: ContactRelation[];
  /** Opportunities this contact sourced (the "referred by" junction). */
  referredOpportunities: ContactOpportunity[];
  /** Opportunities they're a named contact on, excluding ones they referred. */
  involvedOpportunities: ContactOpportunity[];
  /** Projects that grew out of an opportunity this contact referred. */
  referredProjects: ContactProject[];
  /** Companies they're linked to without working there — see {@link ContactRelatedCompany}. */
  relatedCompanies: ContactRelatedCompany[];
  /** Timestamped notes, newest first. */
  notes: EntryView[];
  /** Tasks on this contact — open first, then newest. */
  tasks: TaskView[];
};

/**
 * The full detail for one contact — their identity and employer (optional,
 * resolved via left joins), every person-to-person relationship in both
 * directions, and their CRM footprint: opportunities they referred vs. ones
 * they're merely involved in (kept distinct so the page can label attribution
 * honestly), plus the projects that grew out of the deals they referred. Contacts
 * don't link to projects directly, so project affiliation is derived through those
 * referred opportunities. Returns null if the id is unknown.
 *
 * Wrapped in `React.cache` so `/contacts/[id]`'s `generateMetadata` and the
 * page body share one query set per request (mirrors `getStaffProfile`).
 */
export const getContactDetail = cache(
  async (id: string): Promise<ContactDetail | null> => {
    const [base] = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        role: contacts.role,
        linkedinUrl: contacts.linkedinUrl,
        location: contacts.location,
        companyId: contacts.companyId,
        companyName: companies.name,
        ownerId: contacts.ownerId,
        ownerName: staff.name,
        relationshipStrength: contacts.relationshipStrength,
        isActive: contacts.isActive,
      })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .leftJoin(staff, eq(contacts.ownerId, staff.id))
      .where(eq(contacts.id, id))
      .limit(1);

    if (!base) return null;

    // Shared projection for both opportunity lookups — each joins in the deal's
    // company so the cross-company detail view can name and link the employer.
    const opportunitySelection = {
      id: opportunities.id,
      name: opportunities.name,
      status: opportunities.status,
      source: opportunities.source,
      companyId: opportunities.companyId,
      companyName: companies.name,
    };

    // The other contact on each relationship row, whichever end they're on.
    const other = alias(contacts, "related_contacts");
    const otherCompanies = alias(companies, "related_contact_companies");

    const [
      referredOpportunities,
      involvedAll,
      relatedCompanies,
      relationshipRows,
      notes,
      tasks,
    ] = await Promise.all([
      db
        .select(opportunitySelection)
        .from(opportunitySourceContacts)
        .innerJoin(
          opportunities,
          eq(opportunitySourceContacts.opportunityId, opportunities.id),
        )
        .innerJoin(companies, eq(opportunities.companyId, companies.id))
        .where(eq(opportunitySourceContacts.contactId, id))
        .orderBy(asc(opportunities.name)),
      db
        .select(opportunitySelection)
        .from(opportunityContacts)
        .innerJoin(
          opportunities,
          eq(opportunityContacts.opportunityId, opportunities.id),
        )
        .innerJoin(companies, eq(opportunities.companyId, companies.id))
        .where(eq(opportunityContacts.contactId, id))
        .orderBy(asc(opportunities.name)),
      // Companies they touch without working there. Their employer is on
      // `base.companyId` and never appears here (the write action rejects it).
      db
        .select({
          relationshipId: companyContactRelationships.id,
          id: companies.id,
          name: companies.name,
          isPartner: companies.isPartner,
          description: companyContactRelationships.description,
        })
        .from(companyContactRelationships)
        .innerJoin(
          companies,
          eq(companyContactRelationships.companyId, companies.id),
        )
        .where(eq(companyContactRelationships.contactId, id))
        .orderBy(asc(companies.name)),
      // Every relationship kind, both directions, in one round trip. `related` is
      // symmetric — the row lives on whichever side happened to create it — so
      // the OR is unavoidable; once you have it, the directional kinds come along
      // free and the reverse lookups (direct reports, "moved to") cost nothing
      // extra. INNER join because both FKs are notNull + cascade, so the other
      // side always resolves — which also types `name`/`isActive` as non-null.
      db
        .select({
          relationshipId: contactRelationships.id,
          kind: contactRelationships.kind,
          // Kept in the projection so the partition below can tell which end the
          // viewed contact is on — cheaper and clearer than a SQL CASE.
          ownerId: contactRelationships.contactId,
          id: other.id,
          // Composed in TS via the shared `contactName` helper rather than
          // `contactNameSql`: a raw SQL expression isn't attributable to a table,
          // so the left join below would widen it to `string | null` even though
          // both name columns are notNull on an inner-joined row.
          firstName: other.firstName,
          lastName: other.lastName,
          role: other.role,
          companyId: other.companyId,
          companyName: otherCompanies.name,
          isActive: other.isActive,
          description: contactRelationships.description,
        })
        .from(contactRelationships)
        .innerJoin(
          other,
          or(
            and(
              eq(contactRelationships.contactId, id),
              eq(contactRelationships.relatedContactId, other.id),
            ),
            and(
              eq(contactRelationships.relatedContactId, id),
              eq(contactRelationships.contactId, other.id),
            ),
          ),
        )
        // The other person's own employer, optional.
        .leftJoin(otherCompanies, eq(other.companyId, otherCompanies.id))
        // Redundant with the join condition, but it's what lets the planner pick
        // a BitmapOr over the two single-column indexes before joining.
        .where(
          or(
            eq(contactRelationships.contactId, id),
            eq(contactRelationships.relatedContactId, id),
          ),
        )
        .orderBy(asc(other.lastName), asc(other.firstName)),
      getContactEntries(id),
      getTasksForParent("contact", id),
    ]);

    // Partition the one relationship query into the five groups the sidebar shows.
    // `outgoing` = the viewed contact is this row's `contactId`, i.e. the owning
    // side, which is what distinguishes "Reports to" from "Direct reports" and
    // "Previously" from "Moved to".
    const relations = relationshipRows.map(
      ({ ownerId: owner, firstName, lastName, ...rest }) => ({
        ...rest,
        name: contactName({ firstName, lastName }),
        outgoing: owner === id,
      }),
    );
    // `find` rather than `[0]` for the three singletons — and they're genuinely
    // singular because the partial unique indexes make them so, not because the
    // code assumes it.
    const manager =
      relations.find((r) => r.kind === "reports_to" && r.outgoing) ?? null;
    const directReports = relations.filter(
      (r) => r.kind === "reports_to" && !r.outgoing,
    );
    const predecessor =
      relations.find((r) => r.kind === "succeeds" && r.outgoing) ?? null;
    const successor =
      relations.find((r) => r.kind === "succeeds" && !r.outgoing) ?? null;
    const relatedContacts = relations.filter((r) => r.kind === "related");

    // A contact can be both source and named-contact on the same deal; show it
    // only under "referred" so nothing double-lists.
    const referredIds = new Set(referredOpportunities.map((o) => o.id));
    const involvedOpportunities = involvedAll.filter(
      (o) => !referredIds.has(o.id),
    );

    // The deal this contact referred reached delivery and became a project.
    // The link now lives on `opportunities.projectId` (many opps → one
    // project), so join through opportunities and dedupe by project id — two
    // referred deals could share one project.
    const referredProjects = referredIds.size
      ? await db
          .selectDistinct({
            id: projects.id,
            name: projects.name,
            companyId: projects.companyId,
            companyName: companies.name,
          })
          .from(projects)
          .innerJoin(opportunities, eq(opportunities.projectId, projects.id))
          .innerJoin(companies, eq(projects.companyId, companies.id))
          .where(inArray(opportunities.id, [...referredIds]))
          .orderBy(asc(projects.name))
      : [];

    return {
      ...base,
      manager,
      directReports,
      predecessor,
      successor,
      relatedContacts,
      referredOpportunities,
      involvedOpportunities,
      referredProjects,
      relatedCompanies,
      notes,
      tasks,
    };
  },
);
