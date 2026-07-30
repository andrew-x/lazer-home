import type { FeedbackRating } from "@/lib/performance/feedback-rating";

/**
 * Staff self-evaluations — the pure, client-importable core (no `db`/drizzle).
 *
 * A self-evaluation is a **periodic, dated questionnaire a person fills out about
 * themselves**: seven free-text reflection prompts plus one overall self-rating.
 * It is the first-person counterpart to peer feedback (what colleagues think),
 * review notes (what the manager wrote up) and `staffRating` (the level the
 * manager assigned).
 *
 * !! THE ONE THING TO UNDERSTAND BEFORE CHANGING THIS FILE !!
 *
 * Answers are stored as a **snapshot**: each stored entry carries the `section` and
 * `prompt` *as they were presented when the person answered*, alongside their text.
 * A record is therefore rendered entirely from itself — the reader never consults
 * `SELF_EVALUATION_QUESTIONS` — so rewording a prompt, retiring a question, or
 * adding a new one leaves every existing record reading exactly as it was written.
 * Rendering today's prompt above a two-year-old answer would misrepresent what the
 * person actually said, which is the whole failure mode this design exists to
 * prevent.
 *
 * The current question set below is consulted by exactly **two** things: the form
 * (which questions to present) and the write path (deriving the snapshot). See
 * `docs/domains/performance.md` and the ADR.
 */

/**
 * Bumped whenever the *meaning* of the question set changes — a question added or
 * retired, or a prompt reworded enough that old and new answers aren't comparable.
 * Stored on every record, so "how many rows still answer the v1 questions" is a
 * plain query, and an existing record becomes read-only once the set moves past it
 * (editing it under a newer set would silently drop the answers it holds to
 * questions the form no longer shows).
 */
export const SELF_EVALUATION_QUESTION_SET_VERSION = 1;

/**
 * Canonical display order, and the **stable ids stored in the jsonb**. Prompts,
 * section titles and guidance can change freely; renaming an id is a data
 * migration. **Never reuse a retired id for a different question** — an old record
 * would then claim to answer something it doesn't.
 */
export const SELF_EVALUATION_QUESTION_IDS = [
  "SE_OUTPUT",
  "SE_COMMUNICATION",
  "SE_PRODUCT_MANAGEMENT",
  "SE_AI_COMPETENCY",
  "SE_LAZER_CULTURE",
  "SE_PERSONAL_DEVELOPMENT",
  "SE_GROWTH",
] as const;

export type SelfEvaluationQuestionId =
  (typeof SELF_EVALUATION_QUESTION_IDS)[number];

export type SelfEvaluationQuestion = {
  /** Short section heading — snapshotted with the answer. */
  section: string;
  /** The question itself — snapshotted with the answer. */
  prompt: string;
  /**
   * Sub-prompts that help the writer think. **Deliberately not snapshotted:** this
   * is scaffolding for whoever is filling the form, not part of what was asked, and
   * a reader of a saved record has no use for it.
   */
  guidance: readonly string[];
};

/**
 * The current question set. A `Record` keyed by the id union rather than Manual of
 * Me's bare array, so `tsc` enforces one entry per id — adding an id to the tuple
 * without writing its question is a compile error, not a blank section at runtime.
 */
export const SELF_EVALUATION_QUESTIONS: Record<
  SelfEvaluationQuestionId,
  SelfEvaluationQuestion
> = {
  SE_OUTPUT: {
    section: "Output",
    prompt: "How was the pace and quality of your work output on projects?",
    guidance: [
      "Were timelines met?",
      "Did the deliverables retain a high level of quality?",
      "What was the client feedback?",
    ],
  },
  SE_COMMUNICATION: {
    section: "Communication",
    prompt: "How has the client experience been on your projects?",
    guidance: [
      "Were you proactive?",
      "Did the client have to ask for updates from you?",
      "Did you overcome any friction with the client?",
      "Were you able to collaborate well with other engineers?",
      "Did others on the team know the status of your work and how that impacts their work?",
    ],
  },
  SE_PRODUCT_MANAGEMENT: {
    section: "Product Management",
    prompt: "How was your experience managing your project?",
    guidance: [
      "Were you able to set clear expectations and timelines?",
      "Were you able to prioritize actions and tasks?",
      "Were you able to unblock yourself or others?",
      "Did you ask for additional support from the client or Lazer when needed?",
    ],
  },
  SE_AI_COMPETENCY: {
    section: "AI Competency",
    prompt:
      "How confident are you that you are extracting the most out of the tools available?",
    guidance: [
      "Do you meet the requirements in the AI Competency checklist?",
      "Do you find yourself to be more efficient than before?",
      "Do you understand all the related concepts like working with MCPs, prompt structuring, etc.?",
      "Are there any growth areas or learning areas you still want to get into?",
    ],
  },
  SE_LAZER_CULTURE: {
    section: "Lazer Culture",
    prompt:
      "Were you able to contribute to the community at Lazer through events, demos, or helping others?",
    guidance: [],
  },
  SE_PERSONAL_DEVELOPMENT: {
    section: "Personal Development",
    prompt: "How have you grown since the last time we talked?",
    guidance: [
      "Any new skills, certifications or other progress?",
      "Any progress on bench projects?",
      "Do you have any goals for the next six months?",
      "Any specific progress to goals you set last time we talked?",
    ],
  },
  SE_GROWTH: {
    section: "Growth",
    prompt: "What are some areas you could have done better in the last while?",
    guidance: [],
  },
};

/**
 * One stored answer, as it will be read back forever.
 *
 * `questionId` is **deliberately `string`, not `SelfEvaluationQuestionId`**: a
 * stored record may hold an id that has since been retired from the tuple. Typing
 * it as the union would make those rows unrepresentable and push every reader
 * toward a cast. The *write* path validates against the current union; the *read*
 * path accepts any string. Two schemas over one shape.
 */
export type SelfEvaluationAnswer = {
  questionId: string;
  /** The section heading as presented when this was answered. */
  section: string;
  /** The prompt as presented when this was answered. */
  prompt: string;
  /** Always non-empty — blank answers are omitted from the record entirely. */
  answer: string;
};

/** The self-rating prompt. Not snapshotted: the value set is closed, so the
 *  meaning rides the stored enum value rather than this wording. */
export const SELF_RATING_PROMPT =
  "If you were to rate yourself and your performance over the last 6 months, where would you say you are?";

/**
 * First-person descriptions of the five rating options.
 *
 * The values and labels come from `@/lib/performance/feedback-rating` — the scale
 * *is* peer feedback's five words, and duplicating the tuple would let them drift
 * (ADR 0016). Only the descriptions are re-written here, because
 * `FEEDBACK_RATING_DESCRIPTIONS` is phrased about someone else.
 */
export const SELF_RATING_DESCRIPTIONS: Record<FeedbackRating, string> = {
  ABOVE_AND_BEYOND:
    "Routinely went beyond expectations, uplifted others, and was the most important contributor on the project.",
  TOP_PERFORMER:
    "Delivered high quality output, demonstrated strong ownership and contributed significantly to the success of projects.",
  SOLID_CONTRIBUTOR: "Was a reliable and dependable collaborator.",
  MINOR_MISSES:
    "Was generally good though there were a few minor but noticeable mistakes, gaps in knowledge or lack in contribution.",
  NEEDS_IMPROVEMENT:
    "There were noticeable gaps in skillset or working style that should be talked through.",
};

/** Per-answer cap, shared by the zod schema and the form. */
export const SELF_EVALUATION_ANSWER_MAX = 10_000;

/**
 * Cap on the snapshotted `section` / `prompt` strings. They come from the module
 * above rather than from a person, so this is a sanity bound on the stored payload,
 * not input validation.
 */
export const SELF_EVALUATION_SNAPSHOT_TEXT_MAX = 500;

/**
 * Said out loud above the Save button, because there is no draft state: the moment
 * a self-evaluation is saved, anyone who may see this person's ratings can read it,
 * and deleting is the only way to take it back.
 */
export const SELF_EVALUATION_SAVE_WARNING =
  "Saving makes this visible to managers who can see your evaluations. You can edit or delete it afterwards.";

/** How many prompts the current set asks — the denominator in "N of M answered". */
export const SELF_EVALUATION_QUESTION_COUNT =
  SELF_EVALUATION_QUESTION_IDS.length;

/**
 * Turn a form's raw per-question answers into the stored snapshot, stamping each
 * with the `section`/`prompt` it was answered against.
 *
 * **Blank answers are omitted entirely**, so `entries.length` is the answered count
 * and a record never stores rows that read back as empty blocks. Shared by the
 * create action, the update action and the seed — which makes the seed a real drift
 * guard rather than a parallel implementation.
 */
export function buildSelfEvaluationEntries(
  answers: Record<SelfEvaluationQuestionId, string | null>,
): SelfEvaluationAnswer[] {
  return SELF_EVALUATION_QUESTION_IDS.flatMap((questionId) => {
    const answer = answers[questionId]?.trim();
    if (!answer) return [];
    const { section, prompt } = SELF_EVALUATION_QUESTIONS[questionId];
    return [{ questionId, section, prompt, answer }];
  });
}
