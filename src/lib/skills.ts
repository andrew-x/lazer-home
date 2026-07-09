/**
 * Skills catalogue and proficiency levels.
 *
 * Skills live on a staff profile as an inline list (see the `skills` jsonb column
 * on the `staff` table) rather than a normalized table — each entry pairs a skill
 * name from this hardcoded catalogue with a proficiency level. This module is the
 * single source of truth for both the catalogue and the levels, and is imported by
 * client form UI, server validation, AND the Drizzle schema, so it must stay free
 * of `server-only` imports (like `staff-import/types.ts`).
 *
 * The catalogue is organized by DIMENSION (Type of Work, Languages, …); several
 * dimensions carry sub-groups purely to organize the source below. The picker
 * groups one level deep — by dimension — so `SKILL_CATEGORIES` flattens each
 * dimension's sub-groups into a single ordered skill list.
 */

// --- Proficiency levels ----------------------------------------------------

// Ordered from most to least proficient — drives display order everywhere.
export const PROFICIENCY_LEVELS = [
  "senior",
  "intermediate",
  "learning",
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  senior: "Senior",
  intermediate: "Intermediate",
  learning: "Learning",
};

// --- Source catalogue ------------------------------------------------------
//
// Edit skills here. Sub-grouped dimensions use `discipline → skills`; flat
// dimensions are a plain list. Order is meaningful — it's preserved in the picker.

const TYPE_OF_WORK = {
  General: [
    "Frontend development",
    "Backend development",
    "Cross-platform mobile development (React Native, Flutter, etc.)",
    "Native Android development",
    "Native iOS development",
    "Desktop development",
    "Game development",
    "Infrastructure development",
    "DevOps",
    "Application security testing",
    "QA",
    "SEO (Search engine optimization)",
    "GEO (Generative engine optimization / SEO for LLMs)",
    "Accessibility testing",
    "Performance optimization",
    "Monitoring",
    "Observability",
  ],
  AI: [
    "LLM features",
    "Agentic applications",
    "LLM fine-tuning",
    "LLMOps",
    "Data science / Analytics",
    "Machine learning",
    "Data engineering",
    "Generative media application development",
    "Generative media model fine-tuning",
  ],
  Web3: [
    "dApp development",
    "Smart Contracts / Programs",
    "Blockchain infrastructure",
    "Web3 security and auditing",
    "Protocol development (nodes, consensus, l2, etc.)",
    "Tokenomics / Token launch",
    "Wallets and account abstraction",
    "Onramps / Offramps",
    "Data indexing",
    "RPC management",
  ],
  Shopify: [
    "Theme development",
    "Headless storefront development",
    "iPaaS integration",
    "Internationalization / Markets",
    "Platform data migration",
    "Custom app development",
  ],
  "Growth & Marketing": [
    "Account Mapping",
    "Relationship Management",
    "Event Planning / Strategy",
    "Lead Generation / Management",
  ],
  Design: [
    "UI / UX design",
    "User research",
    "Branding",
    "Motion design",
    "Design Research",
    "Design Strategy",
    "Design Systems",
    "Marketing Design",
    "Branding/Visual Design",
    "Copywriting",
    "Illustrations",
    "Concept Art",
    "Iconography",
    "Typography",
  ],
} as const;

const LANGUAGES = {
  General: [
    "JavaScript / TypeScript",
    "Python",
    "Liquid",
    "Ruby",
    "Go",
    "PHP",
    "Java",
    "Kotlin",
    "C#",
  ],
  Systems: ["Rust", "C++", "C", "Zig"],
  Mobile: ["Swift", "Dart", "Objective-C"],
  Web3: [
    "Solidity",
    "Move (Sui / Aptos)",
    "Vyper",
    "Cairo (Starknet)",
    "Cadence (Flow)",
  ],
  Functional: [
    "Elixir",
    "Erlang",
    "Haskell",
    "Scala",
    "Clojure",
    "F#",
    "OCaml",
  ],
  "Data Science": ["R", "Julia", "MATLAB"],
  Other: ["SQL", "Bash/Shell", "Lua", "Crystal", "Apex (Salesforce)"],
} as const;

const FRAMEWORKS = {
  Frontend: [
    "React",
    "Angular",
    "Vue",
    "Svelte",
    "Astro",
    "Solid.js",
    "Qwik",
    "Gatsby",
  ],
  "Fullstack / Backend": [
    "Next.js",
    "Remix",
    "Express.js",
    "NestJS",
    "Ruby on Rails",
    "Laravel",
    "Django",
    "FastAPI",
    ".NET",
    "Flask",
    "Spring Boot",
    "Phoenix",
    "Hono",
    "TanStack Start",
    "Bun",
  ],
  Mobile: ["React Native", "Expo", "Flutter", "Ionic", "SwiftUI"],
  Desktop: ["Electron", "Tauri"],
  Web3: [
    "Hardhat",
    "Truffle",
    "Foundry",
    "Anchor",
    "World Mini App",
    "Farcaster Mini App",
  ],
  AI: ["TensorFlow", "PyTorch", "LangChain"],
  Shopify: ["Hydrogen"],
} as const;

const HOSTING = [
  "AWS",
  "Google Cloud Platform (GCP)",
  "Microsoft Azure",
  "Oracle - OCI",
  "Digital Ocean",
  "Vercel",
  "Netlify",
  "Cloudflare",
  "Heroku",
  "Supabase",
  "Railway",
  "Render",
  "Fly.io",
  "Modal",
  "Replicate",
  "Together.ai",
  "Runpod",
  "Akash",
  "Paperspace",
  "Neon",
] as const;

const DATABASES = [
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "MongoDB",
  "Redis",
  "BigQuery",
  "Firestore",
  "DynamoDB",
  "Cassandra",
  "Clickhouse",
  "ElasticSearch",
  "Algolia",
  "Neo4j",
  "Pinecone",
  "TimescaleDB",
  "Weaviate",
  "Chroma",
  "Qdrant",
  "Milvus",
  "PlanetScale",
  "CockroachDB",
  "MariaDB",
  "Microsoft SQL Server",
  "Snowflake",
  "InfluxDB",
  "ScyllaDB",
  "FaunaDB",
  "CouchDB",
  "IPFS",
  "Arweave",
  "Athena",
  "Aurora",
] as const;

const DEVOPS = [
  "Docker",
  "Kubernetes",
  "Terraform",
  "Pulumi",
  "GitHub Actions",
  "GitLab CI",
  "CircleCI",
  "Jenkins",
] as const;

const TESTING = {
  "Unit / Integration": [
    "Jest",
    "Vitest",
    "Mocha",
    "Chai",
    "Jasmine",
    "Pytest",
  ],
  "E2E / Browser": ["Cypress", "Playwright", "Puppeteer"],
  Component: ["Testing Library", "Storybook"],
  API: ["Postman"],
  Mobile: ["Detox"],
  Security: ["Snyk", "SonarQube", "OWASP ZAP", "Slither", "Mythril"],
  Performance: ["k6", "Artillery", "Gatling"],
  Accessibility: ["WAVE", "Pa11y"],
} as const;

const TOOLS = {
  Payments: ["Stripe", "PayPal SDK", "Square", "Shopify Payments API"],
  Analytics: [
    "Google Analytics",
    "Segment",
    "Mixpanel",
    "PostHog",
    "Amplitude",
  ],
  CMS: ["Contentful", "Sanity", "Strapi", "Prismic"],
  "Commerce Platforms": [
    "Magento",
    "BigCommerce",
    "Shopware",
    "Salesforce Commerce Cloud",
    "WooCommerce",
  ],
  Design: [
    "Figma",
    "Webflow",
    "Canva",
    "Photoshop",
    "Illustrator",
    "Premier Pro",
    "After Effects",
    "Framer",
    "Lottie",
    "Readymag",
    "Zeplin",
    "Baymard Premium",
    "UX Pilot",
    "InDesign",
    "Figjam",
    "XMind",
    "Balsamiq",
    "Whimsical",
  ],
  "3D Tools": ["Blender", "Spline"],
  "Research Tools": ["Dovetail", "Maze", "UX Tweak", "Contentsquare"],
  "Growth & Marketing": ["Crossbeam", "Builtwith", "Similar Web"],
  Recruiting: ["LinkedIn Recruiter", "Juicebox"],
  AI: [
    "Jupyter Notebooks",
    "Streamlit",
    "Kubeflow",
    "MLFlow",
    "LangGraph",
    "CrewAI",
  ],
  Media: ["Cloudinary", "Imgix", "Uploadcare"],
  Motion: ["Three.js", "Motion", "GSAP"],
  iPaaS: [
    "Zapier",
    "Make",
    "n8n",
    "Workato",
    "Tray.io",
    "MuleSoft",
    "Boomi",
    "Celigo",
  ],
  Integrations: [
    "NetSuite",
    "SAP",
    "Salesforce",
    "Microsoft Dynamics 365",
    "Zendesk",
  ],
  Web3: ["World", "Farcaster"],
  Shopify: ["Shopify GraphQL API", "App Bridge", "Checkout Extensions"],
} as const;

const COMPLIANCE = [
  "WCAG",
  "HIPAA",
  "PIPEDA",
  "FHIR",
  "PCI",
  "GDPR",
  "SOC 2",
  "ISO 27001",
  "NIST",
  "ISO 42001",
  "FedRAMP",
] as const;

// --- Skill catalogue (derived) ---------------------------------------------

// A dimension's source is either a flat skill list or discipline → skills.
type DimensionSource = readonly string[] | Record<string, readonly string[]>;

function flatten(source: DimensionSource): string[] {
  return Array.isArray(source) ? [...source] : Object.values(source).flat();
}

// Dimension label → source. Order is meaningful; it drives the picker order.
const DIMENSIONS: ReadonlyArray<{ name: string; source: DimensionSource }> = [
  { name: "Type of Work", source: TYPE_OF_WORK },
  { name: "Languages", source: LANGUAGES },
  { name: "Frameworks", source: FRAMEWORKS },
  { name: "Hosting", source: HOSTING },
  { name: "Databases", source: DATABASES },
  { name: "DevOps & CI/CD", source: DEVOPS },
  { name: "Testing", source: TESTING },
  { name: "Tools", source: TOOLS },
  { name: "Compliance", source: COMPLIANCE },
];

/**
 * The predefined skills a person can pick from, grouped by dimension. Order is
 * meaningful — dimensions and skills render in this order in the picker.
 */
export const SKILL_CATEGORIES: ReadonlyArray<{
  name: string;
  skills: readonly string[];
}> = DIMENSIONS.map((dimension) => ({
  name: dimension.name,
  skills: flatten(dimension.source),
}));

/** Flat list of every catalogue skill, for membership validation. */
export const ALL_SKILLS: readonly string[] = SKILL_CATEGORIES.flatMap(
  (category) => category.skills,
);

/** Map of skill name → its dimension, for grouping on display. */
export const SKILL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  SKILL_CATEGORIES.flatMap((category) =>
    category.skills.map((skill) => [skill, category.name] as const),
  ),
);

/** A skill a person holds, at a given proficiency level. */
export type StaffSkill = { name: string; level: ProficiencyLevel };
