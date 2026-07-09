import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeedbackDetail } from "@/actions/feedback/getFeedbackDetail";
import { FeedbackDetailFields } from "@/components/feedback/feedback-detail-fields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FEEDBACK_RATING_LABELS } from "@/lib/feedback-rating";
import { formatTimestamp } from "@/lib/format";

export const metadata: Metadata = { title: "Feedback detail" };

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getFeedbackDetail(id);
  if (!detail) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Button variant="ghost" size="sm" render={<Link href="/feedback" />}>
        <IconArrowLeft />
        Back to feedback
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>
            {detail.giverName} → {detail.recipientName}
          </CardTitle>
          <CardDescription>
            {FEEDBACK_RATING_LABELS[detail.rating]} ·{" "}
            {formatTimestamp(detail.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbackDetailFields detail={detail} />
        </CardContent>
      </Card>
    </div>
  );
}
