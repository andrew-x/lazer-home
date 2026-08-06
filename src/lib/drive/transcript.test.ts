import { describe, expect, test } from "bun:test";
import {
  GOOGLE_DOC_MIME,
  TRANSCRIPT_FOLDER_NAMES,
  TRIAGE_WINDOW_DAYS,
  transcriptDocsQuery,
  transcriptFolderQuery,
  transcriptWindowStart,
} from "./transcript";

/**
 * ADR 0037 keeps unit tests deliberate. These earn theirs on the strongest grounds
 * in the repo: **they are the enforcement of a security bound**, not a convenience.
 *
 * ADR 0072 amends ADR 0071 §1's "nothing we run ever enumerates a personal Drive"
 * down to "every personal read is one of two fixed query templates". That amendment
 * is worth exactly what these queries are worth, and every failure mode is invisible
 * to the type checker because each branch returns a `string`:
 *
 * - **An empty `folderIds` must produce `null`, never a query.** A `parents` clause
 *   built from an empty list leaves `mimeType = document` behind, which lists every
 *   Google Doc the person owns. This is the one test that stands between a bounded
 *   read and a full personal-Drive enumeration, and it is why the function returns a
 *   sentinel the caller is forced to handle instead of a best-effort string.
 * - **The mime filter and the parents clause must both always be present.** Either
 *   one missing widens the read; neither absence would fail a type check or a
 *   Drive call.
 * - **Quoting.** An unescaped apostrophe makes Drive reject the whole query, so a
 *   transcript titled "Sam's 1:1" makes search silently dead rather than wrong —
 *   the `driveQuoteValue` lesson from `folder.test.ts`, now on a path where the
 *   input is a user-typed search term.
 */

describe("transcriptFolderQuery", () => {
  test("matches every configured folder name and nothing else", () => {
    const q = transcriptFolderQuery();
    for (const name of TRANSCRIPT_FOLDER_NAMES) {
      expect(q).toContain(`name = '${name}'`);
    }
    // One `name =` per configured name, so no sixth crept in via a stray `or`.
    expect(q.match(/name = /g)).toHaveLength(TRANSCRIPT_FOLDER_NAMES.length);
  });

  test("is confined to folders", () => {
    expect(transcriptFolderQuery()).toContain(
      "mimeType = 'application/vnd.google-apps.folder'",
    );
  });

  test("keeps the name alternation grouped, so the mime filter always applies", () => {
    // Without the parentheses, `a and b or c` parses as `(a and b) or c` in Drive's
    // grammar, and the last name would match folders of ANY type.
    const q = transcriptFolderQuery();
    expect(q).toMatch(/and \(name = .*\)$/);
  });
});

describe("transcriptDocsQuery — the personal-read bound", () => {
  test("returns null for no folders, so a caller cannot list a whole Drive", () => {
    expect(transcriptDocsQuery([])).toBeNull();
    expect(
      transcriptDocsQuery([], { sinceIso: "2026-08-01T00:00:00.000Z" }),
    ).toBeNull();
    expect(transcriptDocsQuery([], { nameContains: "acme" })).toBeNull();
  });

  test("always filters to Google Docs", () => {
    expect(transcriptDocsQuery(["folder1"])).toContain(
      `mimeType = '${GOOGLE_DOC_MIME}'`,
    );
  });

  test("always carries a parents clause", () => {
    expect(transcriptDocsQuery(["folder1"])).toContain("'folder1' in parents");
  });

  test("groups multiple parents so the mime filter is not lost to precedence", () => {
    const q = transcriptDocsQuery(["a", "b"]);
    expect(q).toContain("('a' in parents or 'b' in parents)");
  });

  test("filters on createdTime, not modifiedTime", () => {
    const q = transcriptDocsQuery(["f"], {
      sinceIso: "2026-08-01T00:00:00.000Z",
    });
    expect(q).toContain("createdTime >= '2026-08-01T00:00:00.000Z'");
    expect(q).not.toContain("modifiedTime");
  });

  test("adds a name filter only when asked", () => {
    expect(transcriptDocsQuery(["f"])).not.toContain("name contains");
    expect(transcriptDocsQuery(["f"], { nameContains: "acme" })).toContain(
      "name contains 'acme'",
    );
  });

  test("escapes a search term that would otherwise break the query", () => {
    // A dead combobox for everyone whose meeting had an apostrophe in the title.
    expect(transcriptDocsQuery(["f"], { nameContains: "Sam's 1:1" })).toContain(
      "name contains 'Sam\\'s 1:1'",
    );
    expect(transcriptDocsQuery(["f"], { nameContains: "a\\b" })).toContain(
      "name contains 'a\\\\b'",
    );
  });

  test("escapes a folder id, so a hostile id cannot inject a clause", () => {
    // `driveResourceId` already constrains ids to [A-Za-z0-9_-], making this
    // defence in depth — but the quoting is what holds if that schema is ever
    // relaxed, and it costs nothing to assert.
    expect(transcriptDocsQuery(["a' or name != 'x"])).toContain(
      "'a\\' or name != \\'x' in parents",
    );
  });
});

describe("transcriptWindowStart", () => {
  test("counts back the requested number of days from the given instant", () => {
    const now = Date.parse("2026-08-05T12:00:00.000Z");
    expect(transcriptWindowStart(now, 7)).toBe("2026-07-29T12:00:00.000Z");
  });

  test("covers every step of the show-more ladder", () => {
    const now = Date.parse("2026-08-05T00:00:00.000Z");
    const starts = TRIAGE_WINDOW_DAYS.map((days) =>
      transcriptWindowStart(now, days),
    );
    // Strictly decreasing: each step must reach further back than the last, or
    // "show more" would return the same rows and read as a broken button.
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] < starts[i - 1]).toBe(true);
    }
  });
});
