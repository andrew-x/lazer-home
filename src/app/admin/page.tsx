import {
  IconCalendarEvent,
  IconChevronRight,
  IconUpload,
  IconUserShield,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Admin" };

const ADMIN_TOOLS = [
  {
    title: "Upload staff",
    description:
      "Import staff from a Rippling CSV export — review new vs. updated records before saving.",
    href: "/admin/upload-staff",
    icon: IconUpload,
  },
  {
    title: "Upload PTO",
    description:
      "Import leave records from a Rippling CSV export — review new, updated, and removed entries before saving.",
    href: "/admin/upload-pto",
    icon: IconCalendarEvent,
  },
  {
    title: "Bulk edit roles",
    description:
      "Edit staff employment facts (role, line of business, billability, management) across the team in one pass.",
    href: "/admin/bulk-edit-roles",
    icon: IconUsersGroup,
  },
  {
    title: "Manage users",
    description:
      "Edit application users' RBAC role and ban status inline, then save all changes at once.",
    href: "/admin/manage-users",
    icon: IconUserShield,
  },
];

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Admin actions
        </h2>
        <p className="text-muted-foreground">
          Local-only tools for seeding and maintaining data.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ADMIN_TOOLS.map((tool) => (
          <Card key={tool.href} className="transition-colors hover:bg-muted/40">
            <Link href={tool.href} className="block">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <tool.icon className="size-5 text-muted-foreground" />
                <div className="flex-1">
                  <CardTitle className="text-base">{tool.title}</CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </div>
                <IconChevronRight className="size-4 text-muted-foreground" />
              </CardHeader>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
