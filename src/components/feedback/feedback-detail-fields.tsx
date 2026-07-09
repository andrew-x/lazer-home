/** The free-text body of a feedback item, shared by the detail page + dialog. */
export type FeedbackDetailFieldValues = {
  context: string;
  keepDoing: string | null;
  stopDoing: string | null;
  startDoing: string | null;
  other: string | null;
  messageToRecipient: string | null;
};

/** A labelled section, hidden entirely when empty. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase">
        {label}
      </span>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export function FeedbackDetailFields({
  detail,
}: {
  detail: FeedbackDetailFieldValues;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Context" value={detail.context} />
      <Field label="Keep doing" value={detail.keepDoing} />
      <Field label="Stop doing" value={detail.stopDoing} />
      <Field label="Start doing" value={detail.startDoing} />
      <Field label="Other" value={detail.other} />
      {detail.messageToRecipient ? (
        <div className="flex flex-col gap-1 rounded border border-primary/40 bg-primary/5 p-3">
          <span className="text-xs font-medium text-muted-foreground uppercase">
            Message to recipient (visible to them)
          </span>
          <p className="text-sm whitespace-pre-wrap">
            {detail.messageToRecipient}
          </p>
        </div>
      ) : null}
    </div>
  );
}
