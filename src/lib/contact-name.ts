/**
 * Compose a contact's display name from its parts. A one-liner, but centralized
 * so the `${firstName} ${lastName}` convention lives in one place across the
 * search action, the inline create flow, and the contact detail surfaces. (The
 * SQL-side compose in `getContactsPage` can't share this and stays inline.)
 */
export function contactName({
  firstName,
  lastName,
}: {
  firstName: string;
  lastName: string;
}): string {
  return `${firstName} ${lastName}`;
}
