import "server-only";

import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { contactNameSql } from "@/actions/shared/contactName";
import {
  latestNextStepSubquery,
  toEpochMillis,
} from "@/actions/shared/latestNextStep";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import {
  companies,
  contactEntries,
  contacts,
  opportunities,
  opportunitySourceContacts,
  projects,
  staff,
} from "@/lib/db/schema";

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
  /** Body of the contact's most recent next-step entry, or null if none. */
  nextStep: string | null;
  /** When that next step was logged (epoch millis), or null. */
  nextStepAt: number | null;
};

/**
 * An opportunity a contact at this company referred to us: one of the deal's
 * source contacts works here. Keyed off the referral, not ownership, so the
 * company the opportunity belongs to is often a *different* one — hence the
 * `clientCompany*` fields, which link out. `referrers` are the referring
 * contacts at THIS company (usually one; a deal can have several source
 * contacts here).
 */
export type CompanyReferredOpportunity = {
  id: string;
  name: string;
  status: OpportunityStatus;
  clientCompanyId: string;
  clientCompanyName: string;
  referrers: { id: string; name: string }[];
};

/**
 * A project a contact at this company brought us: it grew out of an opportunity
 * this company's people referred (see {@link CompanyReferredOpportunity}). Same
 * referral-not-ownership framing, so its client company can also differ from the
 * one being viewed.
 */
export type CompanyReferredProject = {
  id: string;
  name: string;
  clientCompanyId: string;
  clientCompanyName: string;
  referrers: { id: string; name: string }[];
};

export type CompanyDetail = {
  id: string;
  name: string;
  websiteUrl: string | null;
  location: string | null;
  isPartner: boolean;
  ownerId: string | null;
  ownerName: string | null;
  opportunities: CompanyOpportunity[];
  projects: CompanyProject[];
  referredOpportunities: CompanyReferredOpportunity[];
  referredProjects: CompanyReferredProject[];
  contacts: CompanyContact[];
};

const contactName = contactNameSql(contacts);

/**
 * Collapse referral rows shaped `{ id, …, referrerId, referrerName }` — one per
 * (entity, referring contact) — into one entry per entity with its distinct
 * `referrers` gathered. Insertion order is preserved (a Map), so a name-ordered
 * input yields a name-ordered result. Shared by the referred-opportunity and
 * referred-project collections, which have the same shape but for their own
 * extra columns.
 */
function groupReferrals<
  T extends { id: string; referrerId: string; referrerName: string },
>(rows: T[]) {
  type Grouped = Omit<T, "referrerId" | "referrerName"> & {
    referrers: { id: string; name: string }[];
  };
  const grouped: Grouped[] = [];
  const byId = new Map<string, Grouped>();
  for (const row of rows) {
    const { referrerId, referrerName, ...rest } = row;
    let entry = byId.get(row.id);
    if (!entry) {
      entry = { ...rest, referrers: [] } as Grouped;
      byId.set(row.id, entry);
      grouped.push(entry);
    }
    if (!entry.referrers.some((r) => r.id === referrerId)) {
      entry.referrers.push({ id: referrerId, name: referrerName });
    }
  }
  return grouped;
}

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
        location: companies.location,
        isPartner: companies.isPartner,
        ownerId: companies.ownerId,
        ownerName: staff.name,
      })
      .from(companies)
      .leftJoin(staff, eq(companies.ownerId, staff.id))
      .where(eq(companies.id, id))
      .limit(1);

    if (!base) return null;

    // Latest next-step per contact, left-joined onto the company's contacts
    // below.
    const latestNextStep = latestNextStepSubquery(
      contactEntries,
      contactEntries.contactId,
    );

    const [
      opportunityRows,
      projectRows,
      referredOpportunityRows,
      referredProjectRows,
      contactRows,
    ] = await Promise.all([
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
      // Opportunities our people brought us: a contact at this company is a
      // source contact on the deal. One row per (opportunity, referring
      // contact) — grouped below. The opportunity's own company is the client,
      // which may differ from this one.
      db
        .select({
          id: opportunities.id,
          name: opportunities.name,
          status: opportunities.status,
          clientCompanyId: opportunities.companyId,
          clientCompanyName: companies.name,
          referrerId: contacts.id,
          referrerName: contactName,
        })
        .from(opportunitySourceContacts)
        .innerJoin(
          contacts,
          eq(opportunitySourceContacts.contactId, contacts.id),
        )
        .innerJoin(
          opportunities,
          eq(opportunitySourceContacts.opportunityId, opportunities.id),
        )
        .innerJoin(companies, eq(opportunities.companyId, companies.id))
        .where(eq(contacts.companyId, id))
        .orderBy(asc(opportunities.name)),
      // Projects our people brought us: the deal they referred reached
      // delivery and became a project. One row per (project, referring
      // contact) — grouped below. The project's own company is the client,
      // which may differ from this one.
      db
        .select({
          id: projects.id,
          name: projects.name,
          clientCompanyId: projects.companyId,
          clientCompanyName: companies.name,
          referrerId: contacts.id,
          referrerName: contactName,
        })
        .from(opportunitySourceContacts)
        .innerJoin(
          contacts,
          eq(opportunitySourceContacts.contactId, contacts.id),
        )
        .innerJoin(
          opportunities,
          eq(opportunitySourceContacts.opportunityId, opportunities.id),
        )
        .innerJoin(projects, eq(opportunities.projectId, projects.id))
        .innerJoin(companies, eq(projects.companyId, companies.id))
        .where(eq(contacts.companyId, id))
        .orderBy(asc(projects.name)),
      db
        .select({
          id: contacts.id,
          name: contactName,
          role: contacts.role,
          email: contacts.email,
          phone: contacts.phone,
          nextStep: latestNextStep.body,
          nextStepAt: latestNextStep.createdAt,
        })
        .from(contacts)
        .leftJoin(latestNextStep, eq(latestNextStep.parentId, contacts.id))
        .where(eq(contacts.companyId, id))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    ]);

    return {
      ...base,
      opportunities: opportunityRows,
      projects: projectRows,
      referredOpportunities: groupReferrals(referredOpportunityRows),
      referredProjects: groupReferrals(referredProjectRows),
      contacts: contactRows.map((row) => ({
        ...row,
        nextStepAt: toEpochMillis(row.nextStepAt),
      })),
    };
  },
);
