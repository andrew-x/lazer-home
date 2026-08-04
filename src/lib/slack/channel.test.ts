import { describe, expect, test } from "bun:test";
import {
  buildSlackChannelCreateName,
  buildSlackChannelName,
  SLACK_CHANNEL_MATCH_THRESHOLD,
  SLACK_CHANNEL_NAME_MAX,
  SLACK_TEST_CHANNEL_PREFIX,
  scoreSlackChannelMatch,
  slackChannelUrl,
  slugifyChannelName,
} from "./channel";

/**
 * ADR 0037 keeps unit tests deliberate rather than routine, and this is the case
 * it carves out: the name builder's boundaries are invisible to the type checker
 * — every branch returns `string` — but getting one wrong surfaces as a Slack
 * `invalid_name` in the user's face, at the end of a flow that has already
 * created nothing. The 80-char cap in particular can only be wrong by one.
 *
 * The scorer is deliberately NOT pinned here beyond the two properties the
 * suggestion UI actually depends on (an exact name wins; an unrelated name is
 * below the propose-it threshold). Its exact coefficients are a tuning knob, and
 * asserting them would just make retuning look like a regression.
 */

describe("slugifyChannelName", () => {
  test("lowercases and hyphenates", () => {
    expect(slugifyChannelName("Acme Platform Build")).toBe(
      "acme-platform-build",
    );
  });

  test("folds accents rather than dropping the letter", () => {
    expect(slugifyChannelName("Café Group")).toBe("cafe-group");
  });

  test("collapses runs and trims edge hyphens", () => {
    expect(slugifyChannelName("  Acme -- (Phase 2)!  ")).toBe("acme-phase-2");
  });

  test("returns empty for text with nothing sluggable", () => {
    expect(slugifyChannelName("★ ✦ ✧")).toBe("");
    expect(slugifyChannelName("---")).toBe("");
  });
});

describe("buildSlackChannelName", () => {
  test("prefixes by kind", () => {
    expect(buildSlackChannelName("scoping", "Acme Rebuild", "opp_1")).toBe(
      "l-scoping-acme-rebuild",
    );
    expect(buildSlackChannelName("project", "Acme Rebuild", "proj_1")).toBe(
      "l-project-acme-rebuild",
    );
  });

  test("budgets the cap against the prefix, not just the slug", () => {
    const name = buildSlackChannelName("scoping", "a".repeat(200), "opp_1");
    expect(name.length).toBe(SLACK_CHANNEL_NAME_MAX);
    expect(name.startsWith("l-scoping-")).toBe(true);
  });

  test("never leaves a trailing hyphen after truncating", () => {
    // Engineered so the cut lands exactly on a hyphen: the prefix is 10 chars,
    // so the slug budget is 70 and character 71 of the slug is the separator.
    const source = `${"a".repeat(70)} tail`;
    const name = buildSlackChannelName("scoping", source, "opp_1");
    expect(name.endsWith("-")).toBe(false);
    expect(name).toBe(`l-scoping-${"a".repeat(70)}`);
  });

  test("falls back to the record id when the name has no slug", () => {
    expect(buildSlackChannelName("scoping", "★", "opp_abc123")).toBe(
      "l-scoping-opp-abc123",
    );
  });

  test("never returns a bare prefix", () => {
    for (const [source, id] of [
      ["★", "✦"],
      ["", ""],
      ["---", "---"],
    ]) {
      const name = buildSlackChannelName("scoping", source, id);
      expect(name).not.toBe("l-scoping-");
      expect(name.length).toBeGreaterThan("l-scoping-".length);
    }
  });
});

describe("buildSlackChannelCreateName", () => {
  // `bun test` runs with NODE_ENV=test, so these exercise the non-production
  // branch — which is the one that matters, since the marker existing at all is
  // what keeps a developer's clicking-about out of the real workspace.
  test("marks non-production channels", () => {
    expect(
      buildSlackChannelCreateName("scoping", "Acme Rebuild", "opp_1"),
    ).toBe(`${SLACK_TEST_CHANNEL_PREFIX}l-scoping-acme-rebuild`);
  });

  test("budgets the 80-char cap against the marker too", () => {
    const name = buildSlackChannelCreateName(
      "scoping",
      "a".repeat(200),
      "opp_1",
    );
    expect(name.length).toBe(SLACK_CHANNEL_NAME_MAX);
    expect(name.startsWith(`${SLACK_TEST_CHANNEL_PREFIX}l-scoping-`)).toBe(
      true,
    );
  });

  test("leaves the canonical name — the one used for matching — unmarked", () => {
    expect(buildSlackChannelName("scoping", "Acme Rebuild", "opp_1")).toBe(
      "l-scoping-acme-rebuild",
    );
  });
});

describe("scoreSlackChannelMatch", () => {
  test("scores the name we would have generated as a perfect match", () => {
    expect(scoreSlackChannelMatch("l-project-acme", "l-project-acme")).toBe(1);
  });

  test("keeps a shortened name above the propose-it threshold", () => {
    const score = scoreSlackChannelMatch(
      "l-project-acme",
      "l-project-acme-platform-build",
    );
    expect(score).toBeGreaterThanOrEqual(SLACK_CHANNEL_MATCH_THRESHOLD);
  });

  test("does not credit two channels for sharing only the prefix", () => {
    // The reason the prefix is stripped before scoring: these share ten leading
    // characters and would otherwise look like a decent match.
    const score = scoreSlackChannelMatch("l-project-acme", "l-project-zeta");
    expect(score).toBeLessThan(SLACK_CHANNEL_MATCH_THRESHOLD);
  });

  test("scores an unrelated channel below the threshold", () => {
    const score = scoreSlackChannelMatch(
      "hr-confidential",
      "l-project-acme-platform-build",
    );
    expect(score).toBeLessThan(SLACK_CHANNEL_MATCH_THRESHOLD);
  });

  test("sees through the non-production marker", () => {
    // Without this, every channel created in dev would look unrelated to the
    // record that created it and would never be suggested back.
    expect(
      scoreSlackChannelMatch(
        `${SLACK_TEST_CHANNEL_PREFIX}l-project-acme`,
        "l-project-acme",
      ),
    ).toBe(1);
  });

  test("matches a channel that ignores the naming convention entirely", () => {
    // Linking deliberately doesn't require the convention, so suggestions must be
    // able to propose a channel that predates it.
    const score = scoreSlackChannelMatch("acme", "l-project-acme");
    expect(score).toBeGreaterThanOrEqual(SLACK_CHANNEL_MATCH_THRESHOLD);
  });
});

describe("slackChannelUrl", () => {
  test("links by id, and scopes to a team when one is configured", () => {
    expect(slackChannelUrl("C0123ABCD")).toBe(
      "https://slack.com/app_redirect?channel=C0123ABCD",
    );
    expect(slackChannelUrl("C0123ABCD", "T0999")).toBe(
      "https://slack.com/app_redirect?channel=C0123ABCD&team=T0999",
    );
  });
});
