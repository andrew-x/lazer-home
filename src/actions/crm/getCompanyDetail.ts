import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/db";
import {
  companies,
  contacts,
  opportunities,
  projects,
  staff,
} from "@/lib/db/schema";
import type { OpportunitySource, OpportunityStatus } from "@/lib/opportunity";

export type CompanyOpportunity = {
  id: string;
  name: string;
  status: OpportunityStatus;
  source: OpportunitySource;
};

export type CompanyProject = {
  id: string;
  name: string;
};

export type CompanyContact = {
  id: string;
  name: string;
  role: string | null;
  email: string;
  phone: string | null;
};

export type CompanyDetail = {
  id: string;
  name: string;
  websiteUrl: string | null;
  isPartner: boolean;
  ownerId: string | null;
  ownerName: string | null;
  opportunities: CompanyOpportunity[];
  projects: CompanyProject[];
  contacts: CompanyContact[];
};

const contactName = sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`;

/**
 * The full detail for one company — its core fields plus everything that hangs
 * off it: pipeline opportunities, delivery projects, and the people (contacts)
 * who work there. Each collection is fetched in parallel and projected to just
 * the columns the detail view renders. Returns null if the id is unknown.
 *
 * Wrapped in `React.cache` so `/companies/[id]`'s `generateMetadata` and the
 * page body share one query set per request (mirrors `getStaffProfile`).
 */
export const getCompanyDetail = cache(
  async (id: string): Promise<CompanyDetail | null> => {
    const [base] = await db
      .select({
        id: companies.id,
        name: companies.name,
        websiteUrl: companies.websiteUrl,
        isPartner: companies.isPartner,
        ownerId: companies.ownerId,
        ownerName: staff.name,
      })
      .from(companies)
      .leftJoin(staff, eq(companies.ownerId, staff.id))
      .where(eq(companies.id, id))
      .limit(1);

    if (!base) return null;

    const [opportunityRows, projectRows, contactRows] = await Promise.all([
      db
        .select({
          id: opportunities.id,
          name: opportunities.name,
          status: opportunities.status,
          source: opportunities.source,
        })
        .from(opportunities)
        .where(eq(opportunities.companyId, id))
        .orderBy(asc(opportunities.name)),
      db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.companyId, id))
        .orderBy(asc(projects.name)),
      db
        .select({
          id: contacts.id,
          name: contactName,
          role: contacts.role,
          email: contacts.email,
          phone: contacts.phone,
        })
        .from(contacts)
        .where(eq(contacts.companyId, id))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    ]);

    return {
      ...base,
      opportunities: opportunityRows,
      projects: projectRows,
      contacts: contactRows,
    };
  },
);
