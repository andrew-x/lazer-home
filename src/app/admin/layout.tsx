import { IconArrowLeft, IconTool } from "@tabler/icons-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocalhost } from "@/lib/admin";

/**
 * The admin area is a local-only tooling surface. It lives OUTSIDE the `(app)`
 * group on purpose: the app layout gates on an active staff record, and the
 * staff-upload tool is what creates those records (chicken-and-egg). Access is
 * gated solely on the request being local — non-local requests 404 the whole
 * segment.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isLocalhost())) notFound();

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-6">
          <IconTool className="size-4 text-muted-foreground" />
          <Link href="/admin" className="font-heading font-semibold">
            Admin
          </Link>
          <span className="text-sm text-muted-foreground">· local only</span>
          <Link
            href="/"
            className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            Back to app
          </Link>
        </div>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
