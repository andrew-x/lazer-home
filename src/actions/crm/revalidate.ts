import { revalidatePath } from "next/cache";

/**
 * Revalidate the pages an opportunity write changes: the board/list, and the home
 * dashboard.
 *
 * `/` is here because it now carries pipeline figures — open counts by stage, band
 * plan value, closed this week/month, and your own owned deals with their next steps
 * — so a status move, a create or delete, a line-of-business change, an owner change,
 * a project link, and a task write all shift a number there. One function so "what
 * does an opportunity write affect" has a single answer; there is no
 * `/opportunities/[id]` route, so the list path is the whole CRM side.
 *
 * `/` is dynamic (it reads cookies), so this is about the **client Router Cache**:
 * without it, navigating back to `/` after moving a card serves a stale RSC payload.
 *
 * **Deliberately NOT called by the project-role writers** (`createProjectRole`,
 * `updateProjectRole`, `deleteProjectRole(s)`, `duplicateProjectRoles`,
 * `extendProjectRole`, `bumpProjectRoles`, `assignRoleStaff`, `allocateStaffToRole`,
 * `updateProjectField`'s budget case). Those move a *plan's* value, so they'd shift a
 * band aggregate by a rounding-scale amount that nobody is watching while they edit a
 * plan on `/projects` — and threading it through nine writers is a lot of omission
 * risk for that. So `/`'s band **values** may lag a plan edit until the next full
 * load, while its **membership** figures (counts, stages, closed) are always fresh.
 * Accepted staleness, with a revisit trigger: if a pipeline value ever becomes a
 * commitment number, do it with a cache tag (ADR 0067's `updateTag` pattern) rather
 * than by sprinkling paths across the projects domain. See docs/decisions/0069.
 */
export function revalidateOpportunity(): void {
  revalidatePath("/opportunities");
  revalidatePath("/");
}

/**
 * Revalidate the pages that render a company after a mutation: the companies
 * list and the company's own `/companies/[id]` detail page. Mirrors staff's
 * `revalidateStaffProfile` so every company write refreshes the same pair.
 */
export function revalidateCompany(companyId: string): void {
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

/**
 * Revalidate the pages that render a contact after a mutation: the contacts
 * list and the contact's own `/contacts/[id]` detail page.
 */
export function revalidateContact(contactId: string): void {
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

/**
 * Revalidate after writing a company ↔ contact relationship. The row renders on
 * **both** detail pages — "Related contacts" on the company, the "Companies" tab
 * on the contact — and either page can create, edit, or remove it, so one write
 * must refresh both sides or the other page shows a stale list.
 */
export function revalidateCompanyContactRelationship(
  companyId: string,
  contactId: string,
): void {
  revalidateCompany(companyId);
  revalidateContact(contactId);
}

/**
 * Revalidate after writing a contact ↔ contact relationship. The row renders on
 * **both** contacts' detail pages — as "Reports to" on one and "Direct reports" on
 * the other, "Previously"/"Moved to", or symmetrically under "Also connected" —
 * and either page can create, edit, or remove it, so one write must refresh both
 * sides or the other page shows a stale list.
 *
 * `revalidateContact` also covers `/contacts`, which a `succeeds` write changes:
 * the predecessor is marked inactive and drops out of the default list.
 */
export function revalidateContactRelationship(
  contactId: string,
  relatedContactId: string,
): void {
  revalidateContact(contactId);
  revalidateContact(relatedContactId);
}
