import { describe, expect, test } from "bun:test";
import {
  COMPANY_STATUS_TAGS,
  type CompanyStatusFlags,
  companyStatusTags,
} from "./company-status";

const NONE: CompanyStatusFlags = {
  isPartner: false,
  isClient: false,
  isProspect: false,
};

describe("companyStatusTags", () => {
  test("returns no tags when no flags are set", () => {
    expect(companyStatusTags(NONE)).toEqual([]);
  });

  test("maps each flag to its tag", () => {
    expect(companyStatusTags({ ...NONE, isPartner: true })).toEqual([
      "partner",
    ]);
    expect(companyStatusTags({ ...NONE, isClient: true })).toEqual(["client"]);
    expect(companyStatusTags({ ...NONE, isProspect: true })).toEqual([
      "prospect",
    ]);
  });

  test("returns multiple tags in canonical order", () => {
    // Flags supplied out of canonical order to prove the output order is fixed.
    expect(
      companyStatusTags({ isProspect: true, isClient: true, isPartner: true }),
    ).toEqual(["partner", "client", "prospect"]);
    expect(
      companyStatusTags({ ...NONE, isProspect: true, isPartner: true }),
    ).toEqual(["partner", "prospect"]);
  });

  test("output order always matches COMPANY_STATUS_TAGS", () => {
    const all = companyStatusTags({
      isPartner: true,
      isClient: true,
      isProspect: true,
    });
    expect(all).toEqual([...COMPANY_STATUS_TAGS]);
  });
});
