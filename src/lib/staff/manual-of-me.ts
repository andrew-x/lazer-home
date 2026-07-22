import { z } from "zod";

/**
 * The "Manual of Me" survey: a set of free-text reflection questions a person
 * fills out on their profile so teammates and managers can work with them well.
 *
 * Declared here as a pure, client-importable module (no `db`/drizzle) so the
 * schema/zod validators, the read layer, and the client UI all share exactly one
 * source of truth for the question ids, titles, and ordering. Answers are stored
 * in the generic `responses` table keyed by (staffId, questionId) — see
 * `@/lib/db/responses-schema`. A future survey adds its own const tuple + defs
 * module and reuses the same table and `upsertResponse` action.
 */

// Canonical order — this is also the display order in the guided editor and the
// profile card.
export const MANUAL_OF_ME_QUESTION_IDS = [
  "MOM_BASICS",
  "MOM_THRIVE",
  "MOM_NEEDS",
  "MOM_SUPERPOWERS",
  "MOM_FEEDBACK",
  "MOM_STRESS",
  "MOM_PASSIONS",
] as const;

export type ManualOfMeQuestionId = (typeof MANUAL_OF_ME_QUESTION_IDS)[number];

export type ManualOfMeQuestion = {
  id: ManualOfMeQuestionId;
  /** The prompt, phrased as a sentence starter. */
  title: string;
  /** Encouraging guidance shown beneath the title. */
  subtitle: string;
  /** All Manual of Me questions are free text for now. */
  type: "text";
};

// Ordered to match MANUAL_OF_ME_QUESTION_IDS.
export const MANUAL_OF_ME_QUESTIONS: readonly ManualOfMeQuestion[] = [
  {
    id: "MOM_BASICS",
    type: "text",
    title: "The basics you should know about me are…",
    subtitle:
      "The basics matter! Share your preferred name, job title, line of business, and primary work location. Are you more introverted or extroverted? What's your personality type? These small details help us get to know you and start working together more smoothly.",
  },
  {
    id: "MOM_THRIVE",
    type: "text",
    title: "What helps me thrive at work, and what hinders my productivity…",
    subtitle:
      "We all have environments, habits, and rhythms that help us thrive. What daily habits allow you do to your best work? When do you feel most productive? Do you like to have focused time with minimal distractions, a clear list of priorities and task management tools? Are you an early bird or a night owl? Do you prefer async or jam sessions to get work done!",
  },
  {
    id: "MOM_NEEDS",
    type: "text",
    title: "What I need from my team/manager to succeed…",
    subtitle:
      "This is about how others can support you. What do you need from your manager and teammates to be successful? Maybe you appreciate when expectations are clearly communicated, value flexibility in how you manage tasks as long as deadlines are met or do best when you get feedback regularly.",
  },
  {
    id: "MOM_SUPERPOWERS",
    type: "text",
    title: "My superpowers at work are…",
    subtitle:
      "Think about what you uniquely bring to the team. Maybe you're the go-to person for simplifying complex problems, keeping the team grounded during stressful moments, spotting risks early, or bringing clarity to chaos. Whatever it is, share the strengths or qualities that set you apart and help the team succeed.",
  },
  {
    id: "MOM_FEEDBACK",
    type: "text",
    title: "The best way to give me feedback is…",
    subtitle:
      "We all learn and grow best when feedback is delivered in a way that resonates. So, whether it's praise, constructive criticism, or an ongoing review, tell us how you prefer to receive it. Do you like a direct chat, a written summary, or something more informal? And importantly, is there any way you absolutely do not like to get feedback?",
  },
  {
    id: "MOM_STRESS",
    type: "text",
    title: "When I'm dealing with stress, I…",
    subtitle:
      "We all have moments when stress creeps in, and how it shows up can be different for everyone. Knowing your own signs not only helps you but also help others recognize what's going on and offer the right kind of support when you need it most. It's totally okay if this takes a little reflection! If you don't have the answer right away, feel free to come back to this question later.",
  },
  {
    id: "MOM_PASSIONS",
    type: "text",
    title: "Beyond work, I'm really passionate about…",
    subtitle:
      "What drives you and excites you when you're not working? Share your passions, hobbies, or any surprising expertise that might not be related to your day job!",
  },
];

/**
 * Reusable questionId validator — the union of known Manual of Me ids. Reused by
 * `upsertResponse.schema.ts`. As more surveys are added, a shared action can
 * accept a `z.union([...])` of each survey's id enum.
 */
export const manualOfMeQuestionId = z.enum(MANUAL_OF_ME_QUESTION_IDS);
