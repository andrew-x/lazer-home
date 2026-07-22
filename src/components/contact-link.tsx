import type { ComponentProps } from "react";
import { cn } from "@/lib/core/utils";

/**
 * The `mailto:`/`tel:` counterparts of `ExternalLink`/`InternalLink`: an anchor
 * to a contact method carrying the app's standard link styling, so the treatment
 * lives in one place instead of being hand-written on each contact table/detail.
 * Each renders its value as the link text by default; extra `className`s merge
 * and any other anchor props pass through.
 */
const linkClassName = "text-primary underline-offset-4 hover:underline";

/** `mailto:` link to an email address. Renders the address as its text. */
export function MailLink({
  email,
  className,
  children,
  ...props
}: { email: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={`mailto:${email}`}
      className={cn(linkClassName, className)}
      {...props}
    >
      {children ?? email}
    </a>
  );
}

/** `tel:` link to a phone number. Renders the number as its text. */
export function PhoneLink({
  phone,
  className,
  children,
  ...props
}: { phone: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={`tel:${phone}`}
      className={cn(linkClassName, className)}
      {...props}
    >
      {children ?? phone}
    </a>
  );
}
