import type { Metadata } from "next";
import { getOpportunitiesBoard } from "@/actions/crm/getOpportunitiesBoard";
import { AddOpportunityDialog } from "@/components/crm/add-opportunity-dialog";
import { OpportunityBoard } from "@/components/crm/opportunity-board";
import { getCurrentUser } from "@/lib/auth";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const [cards, user] = await Promise.all([
    getOpportunitiesBoard(),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Opportunities
        </h2>
        <p className="text-sm text-muted-foreground">
          The deals in our pipeline, from lead to close.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            Pipeline
          </h3>
          {canEdit ? <AddOpportunityDialog /> : null}
        </div>
        <OpportunityBoard cards={cards} canEdit={canEdit} />
      </section>
    </div>
  );
}
