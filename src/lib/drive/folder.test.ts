import { describe, expect, test } from "bun:test";
import {
  buildDriveFolderName,
  DRIVE_FOLDER_MIME,
  DRIVE_FOLDER_NAME_MAX,
  driveFolderNameIsTaken,
  driveFolderUrl,
  driveQuoteValue,
  isDriveFolder,
  suggestFreeDriveFolderName,
  toDriveFolderRef,
} from "./folder";

/**
 * ADR 0037 keeps unit tests deliberate rather than routine. Three things here earn
 * one, for the same reason the Slack name builder does: they are invisible to the
 * type checker (every branch returns `string`) and wrong answers surface as a
 * Drive API error or a stray folder at the end of a flow, not as a compile failure.
 *
 * The sharper ones both fail as *data*, not cosmetics:
 *
 * - **`driveFolderNameIsTaken`** is the only thing standing between the create path
 *   and two folders with the same name in the same parent. Drive permits that
 *   happily, and once it happens the only thing telling them apart is an opaque
 *   id. Its case folding is what the dialog's warning and the server's refusal both
 *   read from, so a difference between them would let the dialog say "free" about a
 *   name the server then rejects.
 * - **`driveQuoteValue`** — an unescaped apostrophe makes Drive reject the whole
 *   query. In the create path that means the sibling listing fails, so the conflict
 *   check sees no names and a duplicate gets through; in search it means a dead
 *   combobox for anyone whose folder has an apostrophe in it.
 *
 * `suggestFreeDriveFolderName` is the gentler case, but its length budgeting is the
 * easiest thing here to get wrong by one character.
 */

describe("buildDriveFolderName", () => {
  test("keeps the record name as-is", () => {
    expect(buildDriveFolderName("Acme Platform Rebuild")).toBe(
      "Acme Platform Rebuild",
    );
  });

  test("collapses runs of whitespace and trims", () => {
    expect(buildDriveFolderName("  Acme   Platform \n Rebuild ")).toBe(
      "Acme Platform Rebuild",
    );
  });

  test("leaves slashes alone — Drive names have no path syntax", () => {
    expect(buildDriveFolderName("Discovery / Scoping")).toBe(
      "Discovery / Scoping",
    );
  });

  test("caps at the maximum length", () => {
    const name = buildDriveFolderName("x".repeat(DRIVE_FOLDER_NAME_MAX + 50));
    expect(name).toHaveLength(DRIVE_FOLDER_NAME_MAX);
  });

  test("a name exactly at the cap is untouched", () => {
    const exact = "y".repeat(DRIVE_FOLDER_NAME_MAX);
    expect(buildDriveFolderName(exact)).toBe(exact);
  });
});

describe("driveFolderNameIsTaken", () => {
  test("is false when no sibling matches", () => {
    expect(driveFolderNameIsTaken("Acme", ["Globex", "Initech"])).toBe(false);
    expect(driveFolderNameIsTaken("Acme", [])).toBe(false);
  });

  test("is true on an exact match", () => {
    expect(driveFolderNameIsTaken("Acme", ["Globex", "Acme"])).toBe(true);
  });

  test("folds case — Drive allows Acme and acme, a folder list does not", () => {
    expect(driveFolderNameIsTaken("Acme", ["ACME"])).toBe(true);
    expect(driveFolderNameIsTaken("aCmE", ["Acme"])).toBe(true);
  });

  test("ignores surrounding whitespace on either side", () => {
    expect(driveFolderNameIsTaken("Acme", ["  Acme  "])).toBe(true);
    expect(driveFolderNameIsTaken("  Acme ", ["Acme"])).toBe(true);
  });

  test("does not match a name that merely contains it", () => {
    expect(driveFolderNameIsTaken("Acme", ["Acme Rebuild", "Acme-1"])).toBe(
      false,
    );
  });
});

describe("suggestFreeDriveFolderName", () => {
  test("suggests -1 when only the base is taken", () => {
    expect(suggestFreeDriveFolderName("Acme", ["Acme"])).toBe("Acme-1");
  });

  test("never suggests the base itself, even when the base is free", () => {
    // It is only ever called BECAUSE the base collided, so returning the base
    // would suggest the very name that was just rejected.
    expect(suggestFreeDriveFolderName("Acme", ["Globex"])).toBe("Acme-1");
  });

  test("walks up to the first free index, not the next after the highest", () => {
    // The gap at -2 is the point: this fills holes rather than always growing.
    expect(
      suggestFreeDriveFolderName("Acme", ["Acme", "Acme-1", "Acme-3"]),
    ).toBe("Acme-2");
  });

  test("keeps counting past a run of taken names", () => {
    expect(
      suggestFreeDriveFolderName("Acme", [
        "Acme",
        "Acme-1",
        "Acme-2",
        "Acme-3",
      ]),
    ).toBe("Acme-4");
  });

  test("folds case when skipping taken suffixes", () => {
    expect(suggestFreeDriveFolderName("Acme", ["acme", "AcMe-1"])).toBe(
      "Acme-2",
    );
  });

  test("budgets the suffix against the length cap", () => {
    const base = "z".repeat(DRIVE_FOLDER_NAME_MAX);
    const result = suggestFreeDriveFolderName(base, [base]);
    expect(result).toHaveLength(DRIVE_FOLDER_NAME_MAX);
    expect(result.endsWith("-1")).toBe(true);
  });

  test("budgets a two-digit suffix too", () => {
    const base = "z".repeat(DRIVE_FOLDER_NAME_MAX);
    // base plus -1..-9 taken, so the answer needs the wider `-10` budget.
    const taken = [
      base,
      ...Array.from(
        { length: 9 },
        (_, i) => `${base.slice(0, DRIVE_FOLDER_NAME_MAX - 2)}-${i + 1}`,
      ),
    ];
    const result = suggestFreeDriveFolderName(base, taken);
    expect(result).toHaveLength(DRIVE_FOLDER_NAME_MAX);
    expect(result.endsWith("-10")).toBe(true);
  });
});

describe("driveQuoteValue", () => {
  test("wraps a plain value in single quotes", () => {
    expect(driveQuoteValue("Acme")).toBe("'Acme'");
  });

  test("escapes an apostrophe rather than breaking the query", () => {
    expect(driveQuoteValue("Sam's deal")).toBe("'Sam\\'s deal'");
  });

  test("escapes backslashes before quotes, so the escape isn't re-escaped", () => {
    expect(driveQuoteValue("a\\b")).toBe("'a\\\\b'");
    expect(driveQuoteValue("a\\'b")).toBe("'a\\\\\\'b'");
  });
});

describe("toDriveFolderRef", () => {
  test("builds a ref with the link derived from the id", () => {
    expect(toDriveFolderRef("1a2b", "Acme")).toEqual({
      id: "1a2b",
      name: "Acme",
      url: driveFolderUrl("1a2b"),
    });
  });

  test("a half-set pair reads as not linked, matching the DB check", () => {
    expect(toDriveFolderRef("1a2b", null)).toBeNull();
    expect(toDriveFolderRef(null, "Acme")).toBeNull();
    expect(toDriveFolderRef(null, null)).toBeNull();
  });
});

describe("isDriveFolder", () => {
  test("distinguishes a folder from a file", () => {
    expect(isDriveFolder(DRIVE_FOLDER_MIME)).toBe(true);
    expect(isDriveFolder("application/pdf")).toBe(false);
  });
});
