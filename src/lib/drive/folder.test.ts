import { describe, expect, test } from "bun:test";
import {
  buildDriveFolderName,
  DRIVE_FOLDER_MIME,
  DRIVE_FOLDER_NAME_MAX,
  driveFolderUrl,
  driveQuoteValue,
  isDriveFolder,
  toDriveFolderRef,
} from "./folder";

/**
 * ADR 0037 keeps unit tests deliberate rather than routine. Two things here earn
 * one, for the same reason the Slack name builder does: they are invisible to the
 * type checker (every branch returns `string`) and wrong answers surface as a
 * Drive API error at the end of a flow, not as a compile failure.
 *
 * `driveQuoteValue` is the sharper of the two. An unescaped apostrophe makes
 * Drive reject the whole query, which breaks the "does this folder already
 * exist" precheck — and a precheck that errors instead of matching means the
 * create path builds a DUPLICATE folder rather than refusing. That is a data
 * outcome, not a cosmetic one.
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
