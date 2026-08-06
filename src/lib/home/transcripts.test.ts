import { describe, expect, test } from "bun:test";
import {
  buildTranscriptViews,
  groupTranscriptsByDay,
  type TranscriptDecision,
  type TranscriptSource,
  type TranscriptView,
  UNDATED_GROUP_KEY,
} from "./transcripts";

/**
 * ADR 0037 keeps unit tests deliberate. This fold earns them on two grounds:
 *
 * 1. **It is a disclosure boundary** (ADR 0063 §5) — its output is serialized into
 *    the home page's HTML. The tests below assert on the *serialized* form rather
 *    than on a field list, so a future spread that widens the payload fails here
 *    instead of shipping. Same technique as `org-status.test.ts`.
 * 2. **The dismissal and multi-assignment rules are invisible to the type checker.**
 *    Dropping a dismissed row and *keeping* an assigned one look identical to
 *    TypeScript, and getting either backwards makes the widget quietly useless — a
 *    list that never clears, or one that loses the record of what was filed.
 */

const FILE: TranscriptSource = {
  id: "1AbC",
  name: "Acme — weekly sync",
  createdTime: "2026-08-01T09:00:00.000Z",
  webViewLink: "https://docs.google.com/document/d/1AbC/edit",
};

function assigned(over: Partial<TranscriptDecision> = {}): TranscriptDecision {
  return {
    driveFileId: "1AbC",
    dismissed: false,
    opportunityId: null,
    projectId: "project-1",
    copiedFileId: "copy-1",
    ...over,
  };
}

describe("buildTranscriptViews — the payload is a disclosure boundary", () => {
  test("carries only the whitelisted fields", () => {
    const [view] = buildTranscriptViews([FILE], [], new Map());
    expect(Object.keys(view).sort()).toEqual([
      "assignments",
      "createdAt",
      "fileId",
      "name",
      "webViewLink",
    ]);
  });

  test("an assignment view carries only its whitelisted fields", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned()],
      new Map([["project-1", "Acme Rebuild"]]),
    );
    expect(Object.keys(views[0].assignments[0]).sort()).toEqual([
      "copyUrl",
      "kind",
      "recordId",
      "recordName",
    ]);
  });

  test("nothing from the source file leaks beyond the whitelist", () => {
    // Drive's file resource carries far more than we ask for, and a future field
    // added to the transport must not ride along into the page.
    const noisy = {
      ...FILE,
      owners: [{ emailAddress: "someone@example.com" }],
      parents: ["secret-transcript-folder-id"],
    } as TranscriptSource;
    const serialized = JSON.stringify(
      buildTranscriptViews([noisy], [], new Map()),
    );
    // The folder ids ARE the read boundary — see the module comment.
    expect(serialized).not.toContain("secret-transcript-folder-id");
    expect(serialized).not.toContain("someone@example.com");
  });
});

describe("buildTranscriptViews — triage rules", () => {
  test("drops a dismissed transcript, so the list actually clears", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned({ dismissed: true, projectId: null, copiedFileId: null })],
      new Map(),
    );
    expect(views).toHaveLength(0);
  });

  test("keeps an assigned transcript, badged with where it went", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned()],
      new Map([["project-1", "Acme Rebuild"]]),
    );
    expect(views).toHaveLength(1);
    expect(views[0].assignments).toHaveLength(1);
    expect(views[0].assignments[0].recordName).toBe("Acme Rebuild");
    expect(views[0].assignments[0].kind).toBe("project");
  });

  test("shows both records when one call was filed to a deal and its project", () => {
    const views = buildTranscriptViews(
      [FILE],
      [
        assigned(),
        assigned({
          projectId: null,
          opportunityId: "opp-1",
          copiedFileId: "copy-2",
        }),
      ],
      new Map([
        ["project-1", "Acme Rebuild"],
        ["opp-1", "Acme Phase 2"],
      ]),
    );
    expect(views[0].assignments.map((a) => a.kind).sort()).toEqual([
      "project",
      "sales",
    ]);
  });

  test("uses the record's CURRENT name, not a snapshot", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned()],
      new Map([["project-1", "Acme Rebuild (renamed)"]]),
    );
    expect(views[0].assignments[0].recordName).toBe("Acme Rebuild (renamed)");
  });

  test("drops an assignment whose record has gone rather than rendering a blank badge", () => {
    const views = buildTranscriptViews([FILE], [assigned()], new Map());
    expect(views).toHaveLength(1);
    expect(views[0].assignments).toHaveLength(0);
  });

  test("links the copy as a Google Doc, not as a folder", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned()],
      new Map([["project-1", "Acme Rebuild"]]),
    );
    // `driveFolderUrl` would produce /drive/folders/<id>, which errors for a file.
    expect(views[0].assignments[0].copyUrl).toBe(
      "https://docs.google.com/document/d/copy-1/edit",
    );
  });

  test("a decision for a different file does not attach to this one", () => {
    const views = buildTranscriptViews(
      [FILE],
      [assigned({ driveFileId: "other" })],
      new Map([["project-1", "Acme Rebuild"]]),
    );
    expect(views[0].assignments).toHaveLength(0);
  });

  test("a missing createdTime becomes null, never a substituted now", () => {
    const [view] = buildTranscriptViews(
      [{ id: "x", name: "No date" }],
      [],
      new Map(),
    );
    expect(view.createdAt).toBeNull();
  });
});

describe("groupTranscriptsByDay", () => {
  // Local-noon instants, so these assertions don't flip with the runner's timezone —
  // the grouping buckets by LOCAL day, which is the whole point of the function.
  const NOW = new Date(2026, 7, 6, 12, 0, 0).getTime(); // Thu 6 Aug 2026, local
  const dayAt = (year: number, month: number, day: number, hour = 12) =>
    new Date(year, month - 1, day, hour).getTime();

  function view(id: string, createdAt: number | null): TranscriptView {
    return {
      fileId: id,
      name: `Meeting ${id}`,
      createdAt,
      webViewLink: null,
      assignments: [],
    };
  }

  test("labels the current and previous day relatively", () => {
    const groups = groupTranscriptsByDay(
      [view("a", dayAt(2026, 8, 6)), view("b", dayAt(2026, 8, 5))],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  test("labels older days with a weekday and date", () => {
    const groups = groupTranscriptsByDay([view("a", dayAt(2026, 8, 3))], NOW);
    expect(groups[0].label).toBe("Mon, Aug 3");
  });

  test("adds the year only when the day is in another year", () => {
    const groups = groupTranscriptsByDay([view("a", dayAt(2025, 12, 30))], NOW);
    expect(groups[0].label).toContain("2025");
  });

  test("orders days newest first", () => {
    const groups = groupTranscriptsByDay(
      [
        view("old", dayAt(2026, 8, 1)),
        view("new", dayAt(2026, 8, 6)),
        view("mid", dayAt(2026, 8, 4)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "2026-08-06",
      "2026-08-04",
      "2026-08-01",
    ]);
  });

  test("keeps several meetings from one day together, in input order", () => {
    const groups = groupTranscriptsByDay(
      [
        view("late", dayAt(2026, 8, 6, 16)),
        view("early", dayAt(2026, 8, 6, 9)),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    // Drive returns createdTime desc; grouping must not reshuffle within a day.
    expect(groups[0].transcripts.map((t) => t.fileId)).toEqual([
      "late",
      "early",
    ]);
  });

  test("keeps undated transcripts and sorts them last", () => {
    const groups = groupTranscriptsByDay(
      [view("undated", null), view("dated", dayAt(2026, 8, 6))],
      NOW,
    );
    // Dropping them would hide a filable transcript — the truncation failure again.
    expect(groups.map((g) => g.key)).toEqual(["2026-08-06", UNDATED_GROUP_KEY]);
    expect(groups[1].label).toBe("Date unknown");
  });

  test("buckets a late-evening meeting on its LOCAL day, not the UTC one", () => {
    // 23:00 local on the 6th is the 7th in UTC anywhere west of Greenwich. Keying
    // off toISOString() would file this under tomorrow.
    const groups = groupTranscriptsByDay(
      [view("evening", dayAt(2026, 8, 6, 23))],
      NOW,
    );
    expect(groups[0].key).toBe("2026-08-06");
    expect(groups[0].label).toBe("Today");
  });

  test("returns nothing for no transcripts", () => {
    expect(groupTranscriptsByDay([], NOW)).toEqual([]);
  });

  test("the key is stable while the label is relative", () => {
    // Same instant, two different 'now's: the key must not move, or React would
    // reuse a mounted group against the wrong day.
    const transcripts = [view("a", dayAt(2026, 8, 6))];
    const today = groupTranscriptsByDay(transcripts, NOW);
    const tomorrow = groupTranscriptsByDay(transcripts, dayAt(2026, 8, 7));
    expect(today[0].key).toBe(tomorrow[0].key);
    expect(today[0].label).toBe("Today");
    expect(tomorrow[0].label).toBe("Yesterday");
  });
});
