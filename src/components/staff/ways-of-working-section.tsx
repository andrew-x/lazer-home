import type { WaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import {
  type MatrixSection,
  WOW_SECTIONS,
  type WowQuestionId,
  type WowSection,
} from "@/lib/staff/ways-of-working";

/**
 * Read view of a person's Ways of Working answers, inside the profile card.
 * Shows only what they've filled in — empty fields and untouched sections are
 * omitted to keep the card focused. The guided editor
 * (`/staff/[id]/ways-of-working`) handles writing.
 */
export function WaysOfWorkingSection({
  responses,
}: {
  responses: WaysOfWorking;
}) {
  if (responses.answeredCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing shared yet — a few notes here help teammates learn how you work.
      </p>
    );
  }

  const list = (id: WowQuestionId) => responses.answers[id].listResponse ?? [];
  const text = (id: WowQuestionId) => responses.answers[id].textResponse;

  // Sections with nothing answered render null (dropped); React skips them.
  return (
    <div className="flex flex-col gap-6">
      {WOW_SECTIONS.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          list={list}
          text={text}
        />
      ))}
    </div>
  );
}

const SAVINGS_LABEL = {
  major: "major savings",
  minor: "minor savings",
  no: "no savings",
} as const;

function SectionView({
  section,
  list,
  text,
}: {
  section: WowSection;
  list: (id: WowQuestionId) => string[];
  text: (id: WowQuestionId) => string | null;
}) {
  const body = renderSection(section, list, text);
  if (!body) return null;
  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {section.title}
      </h4>
      {body}
    </section>
  );
}

/** Returns null when a section has nothing answered (so it's dropped entirely). */
function renderSection(
  section: WowSection,
  list: (id: WowQuestionId) => string[],
  text: (id: WowQuestionId) => string | null,
): React.ReactNode {
  if (section.kind === "matrix") return renderMatrix(section, list);

  const blocks = section.fields
    .map((field) => {
      if (section.kind === "multiselect") {
        const values = list(field.questionId);
        if (values.length === 0) return null;
        return (
          <Field key={field.questionId} label={field.label}>
            <Chips items={values} />
          </Field>
        );
      }
      const value = text(field.questionId);
      if (!value) return null;
      if (section.kind === "single-select") {
        return (
          <Field key={field.questionId} label={field.label}>
            <p className="text-sm">{value}</p>
          </Field>
        );
      }
      return (
        <Field key={field.questionId} label={field.label}>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {value}
          </p>
        </Field>
      );
    })
    .filter(Boolean);

  return blocks.length > 0 ? (
    <div className="flex flex-col gap-4">{blocks}</div>
  ) : null;
}

function renderMatrix(
  section: MatrixSection,
  list: (id: WowQuestionId) => string[],
): React.ReactNode {
  const usageOf = (item: string) => {
    if (list(section.usage.critical).includes(item)) return "Critical";
    if (list(section.usage.common).includes(item)) return "Common";
    if (list(section.usage.avoid).includes(item)) return "Avoid";
    return null;
  };
  const savingsOf = (item: string) => {
    if (list(section.savings.major).includes(item)) return SAVINGS_LABEL.major;
    if (list(section.savings.minor).includes(item)) return SAVINGS_LABEL.minor;
    if (list(section.savings.no).includes(item)) return SAVINGS_LABEL.no;
    return null;
  };

  const groups = section.groups
    .map((group) => {
      const rows = group.items
        .map((item) => ({
          item,
          usage: usageOf(item),
          savings: savingsOf(item),
        }))
        .filter((row) => row.usage !== null);
      return { name: group.name, rows };
    })
    .filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{group.name}</span>
          <ul className="flex flex-col gap-1">
            {group.rows.map((row) => (
              <li
                key={row.item}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span>{row.item}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.usage}
                  {row.savings ? ` · ${row.savings}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-4xl border px-2.5 py-0.5 text-xs text-muted-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
