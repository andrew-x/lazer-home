import { z } from "zod";

/**
 * The "Ways of Working" (WOW) survey: how each person likes to work — the
 * editors and tools they reach for, how they learn, and a detailed look at how
 * they use AI (kinds of work, tools, problems, confidence, output kept, and a
 * seven-question engineering-workflow deep dive).
 *
 * Like `@/lib/manual-of-me`, this is a pure, client-importable module (no
 * `db`/drizzle) so the zod validator, the read layer, and the client UI share
 * one source of truth for the question ids, option lists, and ordering. Answers
 * are stored in the generic `responses` table keyed by (staffId, questionId) —
 * see `@/lib/db/responses-schema`. This is the survey ADR 0028 anticipated: a
 * new const tuple + defs module reusing the same table and `upsertResponse`.
 *
 * Each question uses exactly one response shape: free-text and single-select
 * answers go in `textResponse`; multi-selects and every AI-matrix bucket go in
 * `listResponse` (a jsonb string[]).
 */

// ---------------------------------------------------------------------------
// Option lists (the source of truth for what a person can pick)
// ---------------------------------------------------------------------------

export const IDES = [
  "VS Code",
  "Jetbrains",
  "Cursor",
  "Windsurf",
  "VIM",
  "Emacs",
  "Zed",
  "Neovim",
  "Replit",
  "Loveable",
] as const;

export const LEARNING = [
  "AI tools (Gemini / ChatGPT / etc.)",
  "Google",
  "Stack Overflow",
  "Asking lazerites on Slack",
  "Lazer Lunch and Learns / Shop Talks / etc.",
  "Asking others on Twitter, Telegram, etc.",
  "Books",
  "Youtube",
  "Reddit",
  "Hacker News",
  "Frontend Masters",
  "Coursera / Udemy / etc.",
] as const;

/** AI "types of work", grouped by discipline. */
export const AI_TYPES_OF_WORK = {
  General: [
    "Brainstorming",
    "Search / Research",
    "Learning",
    "Writing documents",
    "Summarizing / Understanding documents",
  ],
  Engineering: [
    "Prototyping UI / UX Design",
    "Writing snippets like SQL / Regex / etc.",
    "Writing feature code",
    "Refactoring code",
    "Writing tests",
    "Debugging",
    "Reviewing code / PR",
  ],
  Design: [
    "Creating / finding inspiration sources",
    "Creating sitemaps",
    "Creating personas",
    "Creating user journey maps",
    "Creating presentations, graphics, and other non-UI/UX designs",
    "Generating wireframes / low-fidelity",
    "Creating high fidelity UI / UX designs",
    "Generating images",
    "Generating videos",
    "Generating copy text",
    "Evaluating designs (usability, accessibility, etc.)",
  ],
} as const;

/** AI tools, grouped by where they're used. */
export const AI_TOOLS = {
  General: [
    "Gemini",
    "ChatGPT",
    "Claude",
    "Perplexity",
    "Google AI Mode",
    "NotebookLM",
  ],
  Engineering: [
    "Cursor",
    "Windsurf",
    "Jetbrains AI",
    "Github Copilot",
    "Claude Code",
    "Gemini CLI",
    "OpenCode",
    "Conductor",
    "GSD",
    "Superset",
    "Superpowers",
  ],
  Prototyping: ["Figma AI", "v0", "Bolt", "Replit", "Loveable"],
  Design: [
    "Stitch",
    "UXPilot",
    "Uizard",
    "Galileo AI",
    "AI Image Generation",
    "AI Video Generation",
  ],
} as const;

export const AI_PROBLEMS = [
  "Generation takes too long",
  "Output doesn't actually address the prompt",
  "Output tone and styling isn't what you want",
  "Output introduces inaccurate or wrong information",
  "AI censorship is too restrictive",
  "AI is responding with outdated info",
] as const;

export const AI_GENERAL_CONFIDENCE = [
  "Haven't touched it much",
  "Played around / just getting started",
  "You know how to give detailed prompts to get targeted answers",
  "You know how to integrate with docs, add examples and use plugins to add more context",
  "You know how to use projects, MCPs, deep research to accomplish larger tasks with the quality you need",
] as const;

export const AI_CODE_CONFIDENCE = [
  "Haven't touched it much",
  "Played around / just getting started",
  "You know how to get it to generate code that fit your requirements",
  "You have rules files for context and you know how to frame your prompts to optimize results",
  "You know how to work with MCPs / agents / plans for maximum productivity and quality.",
] as const;

export const AI_OUTPUT = ["100%", "75%", "50%", "25%", "0%"] as const;

export const ENGINEERING_WORKFLOW_INTRO = {
  guidance: [
    "If your workflow is simplistic or light-touch for certain kinds of work, say so and say why. That's just as informative as an elaborate setup.",
    "Be as specific as possible, give details on exact workflows, tools and processes that you actively use.",
    "Mention what you've tried and dropped. The things you abandoned are often more useful signal than the things you kept.",
  ],
  sequence:
    "The questions are sequenced along a project lifecycle: setup, planning, mid-build problems, review, and a catch-all at the end. Question 1 asks you to anchor on a real project so the rest of your answers have concrete context.",
} as const;

/** The seven engineering-workflow questions, in lifecycle order. */
export const ENGINEERING_WORKFLOW_QUESTIONS = [
  {
    id: "WOW_ENGINEERING_WORKFLOW_PROJECT_CONTEXT",
    title: "Project Context",
    prompt:
      "Describe a project you're currently working on or recently finished. What's the stack, what does the system do, and what's your role on it? Use this as the reference point for the rest of your answers.",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_AI_SETUP",
    title: "AI Setup",
    prompt:
      "For the project you described, what AI setup or configuration did you use? Walk through the rules, MCP, skills, subagents, hooks, or other setup that mattered. For each piece, why that mechanism over the alternatives? What did you deliberately leave out?",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_CONFIG_EVOLUTION",
    title: "Configuration Evolution",
    prompt:
      "As that project progressed, how did your AI configuration evolve? What triggered updates, and what did you change, add, remove, or decide not to formalize?",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_COMPLEX_FEATURE",
    title: "Complex Feature Approach",
    prompt:
      "For a large or complex feature on that project, walk through how you approached the work with AI assistance. What did the shape of the work look like, and why?",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_DEBUGGING_AI_OUTPUT",
    title: "Debugging AI Output",
    prompt:
      "Think about a time on that project when AI output was wrong, incomplete, or started creating follow-up issues. If you don't have an exact example, use this scenario: it imported a library that doesn't exist, ignored your error handling conventions, and fixed one thing while breaking another. Walk through your diagnostic process. How do you figure out what's actually going wrong?",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_REVIEW_VERIFICATION",
    title: "Review and Verification",
    prompt:
      "For the project you described, walk through how you verify and review AI-generated code before merging. How does this differ from reviewing human-written code?",
  },
  {
    id: "WOW_ENGINEERING_WORKFLOW_OTHER",
    title: "Other Workflow Notes",
    prompt:
      "Anything else from that project or workflow worth surfacing? Include things you've tried and abandoned, things you wish existed, or things you do that you suspect others don't.",
  },
] as const;

// ---------------------------------------------------------------------------
// Question ids
//
// The full set of `WOW_` ids, in canonical order. This tuple is the source of
// truth for the zod validator and the read layer; the section layout below
// governs how they're grouped and rendered.
// ---------------------------------------------------------------------------

export const WAYS_OF_WORKING_QUESTION_IDS = [
  // Editors & learning
  "WOW_PREFER_IDE",
  "WOW_PREFER_LEARNING",
  // Resources & side projects
  "WOW_RESOURCES",
  "WOW_SIDE_PROJECTS",
  // AI — types of work (usage + savings buckets)
  "WOW_CRITICAL_TYPE_OF_WORK",
  "WOW_COMMON_TYPE_OF_WORK",
  "WOW_AVOID_TYPE_OF_WORK",
  "WOW_MAJOR_SAVINGS_TYPE_OF_WORK",
  "WOW_MINOR_SAVINGS_TYPE_OF_WORK",
  "WOW_NO_SAVINGS_TYPE_OF_WORK",
  // AI — tools (usage + savings buckets)
  "WOW_CRITICAL_TOOL",
  "WOW_COMMON_TOOL",
  "WOW_AVOID_TOOL",
  "WOW_MAJOR_SAVINGS_TOOL",
  "WOW_MINOR_SAVINGS_TOOL",
  "WOW_NO_SAVINGS_TOOL",
  // AI — problems
  "WOW_FREQUENT_PROBLEM",
  "WOW_RARE_PROBLEM",
  // AI — confidence & output
  "WOW_GENERAL_CONFIDENCE",
  "WOW_CODE_CONFIDENCE",
  "WOW_DOCUMENT_KEEP",
  "WOW_CODE_KEEP",
  // Engineering workflows
  "WOW_ENGINEERING_WORKFLOW_PROJECT_CONTEXT",
  "WOW_ENGINEERING_WORKFLOW_AI_SETUP",
  "WOW_ENGINEERING_WORKFLOW_CONFIG_EVOLUTION",
  "WOW_ENGINEERING_WORKFLOW_COMPLEX_FEATURE",
  "WOW_ENGINEERING_WORKFLOW_DEBUGGING_AI_OUTPUT",
  "WOW_ENGINEERING_WORKFLOW_REVIEW_VERIFICATION",
  "WOW_ENGINEERING_WORKFLOW_OTHER",
  // Other
  "WOW_OTHER_THOUGHTS",
] as const;

export type WowQuestionId = (typeof WAYS_OF_WORKING_QUESTION_IDS)[number];

/**
 * Reusable questionId validator — the union of known WOW ids. Reused by
 * `upsertResponse.schema.ts` (as one arm of a `z.union([...])` with the other
 * surveys' id enums), so a crafted id can't write an arbitrary row.
 */
export const waysOfWorkingQuestionId = z.enum(WAYS_OF_WORKING_QUESTION_IDS);

// ---------------------------------------------------------------------------
// Section layout — drives both the guided editor (one step per section) and the
// read-only profile view (same order). A discriminated union on `kind`; each
// field's response shape is implied by the kind (multiselect/matrix → list,
// text/single-select → text).
// ---------------------------------------------------------------------------

export type MultiselectField = {
  questionId: WowQuestionId;
  label: string;
  subtitle?: string;
  options: readonly string[];
};

export type TextField = {
  questionId: WowQuestionId;
  label: string;
  subtitle?: string;
  placeholder?: string;
};

export type SingleSelectField = {
  questionId: WowQuestionId;
  label: string;
  subtitle?: string;
  options: readonly string[];
};

/** A usage/savings matrix: each item is tagged with a usage tier, then a
 * savings tier. The tags decompose into six list-backed question ids. */
export type MatrixSection = {
  kind: "matrix";
  id: string;
  title: string;
  subtitle?: string;
  groups: readonly { name: string; items: readonly string[] }[];
  usage: {
    critical: WowQuestionId;
    common: WowQuestionId;
    avoid: WowQuestionId;
  };
  savings: { major: WowQuestionId; minor: WowQuestionId; no: WowQuestionId };
};

export type WowSection =
  | {
      kind: "multiselect";
      id: string;
      title: string;
      subtitle?: string;
      fields: readonly MultiselectField[];
    }
  | {
      kind: "text";
      id: string;
      title: string;
      subtitle?: string;
      intro?: typeof ENGINEERING_WORKFLOW_INTRO;
      fields: readonly TextField[];
    }
  | {
      kind: "single-select";
      id: string;
      title: string;
      subtitle?: string;
      fields: readonly SingleSelectField[];
    }
  | MatrixSection;

const toGroups = (source: Record<string, readonly string[]>) =>
  Object.entries(source).map(([name, items]) => ({ name, items }));

export const WOW_SECTIONS: readonly WowSection[] = [
  {
    kind: "multiselect",
    id: "editors-learning",
    title: "Editors & Learning",
    subtitle: "What you reach for day to day.",
    fields: [
      {
        questionId: "WOW_PREFER_IDE",
        label: "What IDE or editor are you using regularly?",
        subtitle:
          "This doesn't include companion tools like Claude Code, Cursor CLI, etc.",
        options: IDES,
      },
      {
        questionId: "WOW_PREFER_LEARNING",
        label: "What learning sources are you using regularly?",
        subtitle:
          "When you're learning a new tool, framework, industry, etc. — what do you find most effective?",
        options: LEARNING,
      },
    ],
  },
  {
    kind: "text",
    id: "resources-side-projects",
    title: "Resources & Side Projects",
    fields: [
      {
        questionId: "WOW_RESOURCES",
        label:
          "Any useful resources, tools, YouTube channels, books, or anything else that could be useful to other Lazerites?",
        placeholder: "Share links, names, and why they're worth a look.",
      },
      {
        questionId: "WOW_SIDE_PROJECTS",
        label: "Tell us about any cool side projects you're working on.",
        placeholder: "What is it, and what's fun about building it?",
      },
    ],
  },
  {
    kind: "matrix",
    id: "ai-types-of-work",
    title: "AI — Types of Work",
    subtitle:
      "For each kind of work, mark how you use AI (critical, common, or something you avoid), then how much time it saves you.",
    groups: toGroups(AI_TYPES_OF_WORK),
    usage: {
      critical: "WOW_CRITICAL_TYPE_OF_WORK",
      common: "WOW_COMMON_TYPE_OF_WORK",
      avoid: "WOW_AVOID_TYPE_OF_WORK",
    },
    savings: {
      major: "WOW_MAJOR_SAVINGS_TYPE_OF_WORK",
      minor: "WOW_MINOR_SAVINGS_TYPE_OF_WORK",
      no: "WOW_NO_SAVINGS_TYPE_OF_WORK",
    },
  },
  {
    kind: "matrix",
    id: "ai-tools",
    title: "AI — Tools",
    subtitle:
      "For each tool, mark how you use it (critical, common, or avoided), then how much time it saves you.",
    groups: toGroups(AI_TOOLS),
    usage: {
      critical: "WOW_CRITICAL_TOOL",
      common: "WOW_COMMON_TOOL",
      avoid: "WOW_AVOID_TOOL",
    },
    savings: {
      major: "WOW_MAJOR_SAVINGS_TOOL",
      minor: "WOW_MINOR_SAVINGS_TOOL",
      no: "WOW_NO_SAVINGS_TOOL",
    },
  },
  {
    kind: "multiselect",
    id: "ai-problems",
    title: "AI — Problems",
    subtitle: "Which problems do you hit, and how often?",
    fields: [
      {
        questionId: "WOW_FREQUENT_PROBLEM",
        label: "Problems you hit frequently",
        options: AI_PROBLEMS,
      },
      {
        questionId: "WOW_RARE_PROBLEM",
        label: "Problems you hit rarely",
        options: AI_PROBLEMS,
      },
    ],
  },
  {
    kind: "single-select",
    id: "ai-confidence-output",
    title: "AI — Confidence & Output",
    subtitle:
      "How comfortable are you with AI tools, and how much of what they produce do you keep?",
    fields: [
      {
        questionId: "WOW_GENERAL_CONFIDENCE",
        label: "General AI tool confidence",
        options: AI_GENERAL_CONFIDENCE,
      },
      {
        questionId: "WOW_CODE_CONFIDENCE",
        label: "Code-focused AI tool confidence",
        options: AI_CODE_CONFIDENCE,
      },
      {
        questionId: "WOW_DOCUMENT_KEEP",
        label: "What % of AI-generated documents do you keep as-is?",
        options: AI_OUTPUT,
      },
      {
        questionId: "WOW_CODE_KEEP",
        label: "What % of AI-generated code do you keep as-is?",
        options: AI_OUTPUT,
      },
    ],
  },
  {
    kind: "text",
    id: "engineering-workflows",
    title: "Engineering Workflows",
    subtitle:
      "Seven open-ended questions about a real project. Anchor on one project in the first answer and use it as the reference point for the rest.",
    intro: ENGINEERING_WORKFLOW_INTRO,
    fields: ENGINEERING_WORKFLOW_QUESTIONS.map((question) => ({
      questionId: question.id,
      label: question.title,
      subtitle: question.prompt,
    })),
  },
  {
    kind: "text",
    id: "other",
    title: "Other",
    fields: [
      {
        questionId: "WOW_OTHER_THOUGHTS",
        label: "Any other thoughts or tips?",
        placeholder: "Anything else worth sharing.",
      },
    ],
  },
];

/**
 * Whether a question stores its answer in `listResponse` (multi-select /
 * matrix) vs `textResponse` (free-text / single-select). Derived once from the
 * section layout so the two never drift.
 */
export const WOW_LIST_QUESTION_IDS: ReadonlySet<WowQuestionId> = new Set(
  WOW_SECTIONS.flatMap((section) => {
    if (section.kind === "multiselect") {
      return section.fields.map((field) => field.questionId);
    }
    if (section.kind === "matrix") {
      return [
        section.usage.critical,
        section.usage.common,
        section.usage.avoid,
        section.savings.major,
        section.savings.minor,
        section.savings.no,
      ];
    }
    return [];
  }),
);
