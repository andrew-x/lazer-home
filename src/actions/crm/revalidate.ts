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
