import { IconPlus } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFeedbackAboutMe } from "@/actions/feedback/getFeedbackAboutMe";
import { getFeedbackAboutReports } from "@/actions/feedback/getFeedbackAboutReports";
import { getFeedbackIGave } from "@/actions/feedback/getFeedbackIGave";
import { FeedbackAboutMe } from "@/components/feedback/feedback-about-me";
import { FeedbackAboutReportsTable } from "@/components/feedback/feedback-about-reports-table";
import { FeedbackGivenTable } from "@/components/feedback/feedback-given-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Peer Feedback" };

export default async function FeedbackPage() {
  // `aboutReports` is null when the caller isn't a reviewer — the tab is hidden
  // entirely rather than rendered empty.
  const [aboutMe, iGave, aboutReports] = await Promise.all([
    getFeedbackAboutMe(),
    getFeedbackIGave(),
    getFeedbackAboutReports(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Peer Feedback
          </h2>
          <p className="text-sm text-muted-foreground">
            Give and receive peer feedback across the team.
          </p>
        </div>
        <Button size="sm" render={<Link href="/feedback/new" />}>
          <IconPlus />
          Give feedback
        </Button>
      </header>

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">
            About you ({aboutMe.length})
          </TabsTrigger>
          <TabsTrigger value="given">You've given ({iGave.length})</TabsTrigger>
          {aboutReports ? (
            <TabsTrigger value="reports">
              Your reports ({aboutReports.length})
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="received" className="flex flex-col gap-3 pt-2">
          <p className="text-sm text-muted-foreground">
            You can see who left feedback and any message they shared with you.
            The rest of each review stays private.
          </p>
          <FeedbackAboutMe rows={aboutMe} />
        </TabsContent>

        <TabsContent value="given" className="pt-2">
          <div className="rounded-md border">
            <FeedbackGivenTable rows={iGave} />
          </div>
        </TabsContent>

        {aboutReports ? (
          <TabsContent value="reports" className="flex flex-col gap-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Feedback your direct reports have received. As a reviewer you can
              see each item in full — they can't.
            </p>
            <FeedbackAboutReportsTable rows={aboutReports} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
