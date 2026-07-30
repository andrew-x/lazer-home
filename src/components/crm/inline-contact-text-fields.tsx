"use client";

import { type ComponentProps, type ReactNode, useState } from "react";
import { MailLink, PhoneLink } from "@/components/contact-link";
import { EmptyCell } from "@/components/empty-cell";
import { ExternalLink } from "@/components/external-link";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { Input } from "@/components/ui/input";
import {
  type ContactFieldEdit,
  useContactInlineSave,
} from "./use-contact-inline-save";

/**
 * The contact's three text-valued contact methods — email, phone and LinkedIn —
 * each editable in place in the detail sidebar. They read as the same
 * `mailto:`/`tel:`/external links they always did, and swap in a single text input
 * on the pencil, so the sidebar is the one place these are edited and the dialog is
 * left with the identity block.
 *
 * All three are the same field with different validation, so they share
 * `ContactTextField` below and differ only in what they render when read, what the
 * input looks like, and which `updateContactField` variant they commit. Validation
 * isn't duplicated here at all: the variant's schema is the same `contactFields`
 * refinement the create/edit forms use, and `useContactInlineSave` parses against it
 * client-side, so "Enter a valid email." arrives without a round-trip and a bare
 * "acme.com/in/x" still gets its `https://` filled in.
 */

/** Email. Required (the column is `notNull`), so clearing it reports rather than saves. */
export function InlineContactEmailField({
  contactId,
  canEdit,
  email,
}: {
  contactId: string;
  canEdit: boolean;
  email: string;
}) {
  return (
    <ContactTextField
      contactId={contactId}
      canEdit={canEdit}
      label="Email"
      value={email}
      display={<MailLink email={email} />}
      inputProps={{
        type: "email",
        inputMode: "email",
        placeholder: "person@company.com",
      }}
      toEdit={(draft) => ({ field: "email", email: draft })}
    />
  );
}

/** Phone. Optional — clearing the input saves null. */
export function InlineContactPhoneField({
  contactId,
  canEdit,
  phone,
}: {
  contactId: string;
  canEdit: boolean;
  phone: string | null;
}) {
  return (
    <ContactTextField
      contactId={contactId}
      canEdit={canEdit}
      label="Phone"
      value={phone}
      display={phone ? <PhoneLink phone={phone} /> : null}
      inputProps={{
        type: "tel",
        inputMode: "tel",
        placeholder: "+1 555 123 4567",
      }}
      toEdit={(draft) => ({ field: "phone", phone: draft })}
    />
  );
}

/**
 * LinkedIn. Reads as a "Profile" link rather than the raw URL — the sidebar rail is
 * narrow and the URL itself says nothing a profile link doesn't. Editing shows the
 * stored URL, since that's the thing being changed.
 */
export function InlineContactLinkedinField({
  contactId,
  canEdit,
  linkedinUrl,
}: {
  contactId: string;
  canEdit: boolean;
  linkedinUrl: string | null;
}) {
  return (
    <ContactTextField
      contactId={contactId}
      canEdit={canEdit}
      label="LinkedIn"
      value={linkedinUrl}
      display={
        linkedinUrl ? (
          <ExternalLink href={linkedinUrl}>Profile</ExternalLink>
        ) : null
      }
      inputProps={{
        inputMode: "url",
        placeholder: "linkedin.com/in/username",
      }}
      toEdit={(draft) => ({ field: "linkedinUrl", linkedinUrl: draft })}
    />
  );
}

function ContactTextField({
  contactId,
  canEdit,
  label,
  value,
  display,
  inputProps,
  toEdit,
}: {
  contactId: string;
  canEdit: boolean;
  label: string;
  /** The stored value — seeded into the draft each time the field is opened. */
  value: string | null;
  /** Read-mode rendering; an em dash stands in when there's no value. */
  display: ReactNode;
  inputProps: Omit<ComponentProps<typeof Input>, "value" | "onChange">;
  /** The `updateContactField` variant this field owns, minus the contact id. */
  toEdit: (draft: string) => ContactFieldEdit;
}) {
  const save = useContactInlineSave(contactId);
  const [draft, setDraft] = useState(value ?? "");

  const open = () => {
    // Re-seed from the server value: a previous cancel, or an edit made in another
    // tab, could have left the draft out of step with what's rendered.
    setDraft(value ?? "");
    save.open();
  };
  const confirm = () => save.commit(toEdit(draft));

  return (
    <InlineEditField
      label={label}
      display={display ?? <EmptyCell />}
      editing={save.editing}
      canEdit={canEdit}
      isSaving={save.isPending}
      error={save.error}
      onEdit={open}
      onCancel={save.close}
      onConfirm={confirm}
    >
      <Input
        // Spread first: the type/placeholder a caller supplies must not be able to
        // override the wiring below it.
        {...inputProps}
        // Editing is a deliberate click on the pencil, so the caret belongs in the
        // input that click just revealed (same as `ProjectNameField`).
        autoFocus
        aria-label={label}
        aria-invalid={Boolean(save.error)}
        value={draft}
        onChange={(event) => {
          save.clearError();
          setDraft(event.target.value);
        }}
        // A one-line text field: Enter saves and Escape backs out, so the common
        // edit never needs the mouse to travel back up to the tick.
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirm();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            save.close();
          }
        }}
      />
    </InlineEditField>
  );
}
