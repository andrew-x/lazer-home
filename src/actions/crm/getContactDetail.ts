import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { contactNameSql } from "@/actions/shared/contactName";
import { db } from "@/lib/db/db";
import {
  companies,
  contacts,
  opportunities,
  opportunityContacts,
  opportunitySourceContacts,
  projects,
  staff,
} from "@/lib/db/schema";
import type { OpportunitySource, OpportunityStatus } from "@/lib/opportunity";

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

export type ContactDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string | null;
  linkedinUrl: string | null;
  companyId: string | null;
  companyName: string | null;
  managerId: string | null;
  managerName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  /** Opportunities this contact sourced (the "referred by" junction). */
  referredOpportunities: ContactOpportunity[];
  /** Opportunities they're a named contact on, excluding ones they referred. */
  involvedOpportunities: ContactOpportunity[];
  /** Projects that grew out of an opportunity this contact referred. */
  referredProjects: ContactProject[];
};

/**
 * The full detail for one contact — their identity, employer and manager (both
 * optional, resolved via left joins), and their CRM footprint: opportunities
 * they referred vs. ones they're merely involved in (kept distinct so the
 * page can label attribution honestly), plus the projects that grew out of the
 * deals they referred. Contacts don't link to projects directly, so project
 * affiliation is derived through those referred opportunities. Returns null if
 * the id is unknown.
 *
 * Wrapped in `React.cache` so `/contacts/[id]`'s `generateMetadata` and the
 * page body share one query set per request (mirrors `getStaffProfile`).
 */
export const getContactDetail = cache(
  async (id: string): Promise<ContactDetail | null> => {
    const managers = alias(contacts, "managers");

    const [base] = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        role: contacts.role,
        linkedinUrl: contacts.linkedinUrl,
        companyId: contacts.companyId,
        companyName: companies.name,
        managerId: contacts.managerId,
        managerName: contactNameSql<string | null>(managers),
        ownerId: contacts.ownerId,
        ownerName: staff.name,
      })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .leftJoin(managers, eq(contacts.managerId, managers.id))
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

    const [referredOpportunities, involvedAll] = await Promise.all([
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
    ]);

    // A contact can be both source and named-contact on the same deal; show it
    // only under "referred" so nothing double-lists.
    const referredIds = new Set(referredOpportunities.map((o) => o.id));
    const involvedOpportunities = involvedAll.filter(
      (o) => !referredIds.has(o.id),
    );

    const referredProjects = referredIds.size
      ? await db
          .select({
            id: projects.id,
            name: projects.name,
            companyId: projects.companyId,
            companyName: companies.name,
          })
          .from(projects)
          .innerJoin(companies, eq(projects.companyId, companies.id))
          .where(inArray(projects.opportunityId, [...referredIds]))
          .orderBy(asc(projects.name))
      : [];

    return {
      ...base,
      referredOpportunities,
      involvedOpportunities,
      referredProjects,
    };
  },
);
