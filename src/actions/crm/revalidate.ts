import { revalidatePath } from "next/cache";

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
