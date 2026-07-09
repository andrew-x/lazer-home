import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Give feedback" };

export default function NewFeedbackPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Button variant="ghost" size="sm" render={<Link href="/feedback" />}>
        <IconArrowLeft />
        Back to feedback
      </Button>

      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Give feedback
        </h2>
        <p className="text-sm text-muted-foreground">
          Share structured feedback about a colleague. Only the message to the
          recipient is visible to them.
        </p>
      </header>

      <FeedbackForm />
    </div>
  );
}
