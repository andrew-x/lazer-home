import { describe, expect, test } from "bun:test";
import { UserSafeActionError } from "./errors";
import {
  type AppRole,
  requirePermission,
  roles,
  userHasPermission,
} from "./permissions";

/**
 * The canonical role → permission matrix. This MUST stay in lockstep with
 * docs/domains/permissions.md (the durable contract) and `/audit-rbac`.
 * Changing a role's permissions requires changing this table too — that is the
 * point: the matrix can't drift silently.
 */
const MATRIX: Record<
  AppRole,
  {
    staffEdit: boolean;
    staffViewCompensation: boolean;
    ptoReview: boolean;
    crmEdit: boolean;
    projectsEdit: boolean;
    feedbackReview: boolean;
    timesheetsEdit: boolean;
  }
> = {
  user: {
    staffEdit: false,
    staffViewCompensation: false,
    ptoReview: false,
    crmEdit: false,
    projectsEdit: false,
    feedbackReview: false,
    timesheetsEdit: false,
  },
  "delivery-manager": {
    staffEdit: false,
    staffViewCompensation: false,
    ptoReview: false,
    crmEdit: false,
    projectsEdit: true,
    feedbackReview: false,
    timesheetsEdit: false,
  },
  finance: {
    staffEdit: false,
    staffViewCompensation: true,
    ptoReview: false,
    crmEdit: false,
    projectsEdit: false,
    feedbackReview: false,
    timesheetsEdit: false,
  },
  sales: {
    staffEdit: false,
    staffViewCompensation: false,
    ptoReview: false,
    crmEdit: true,
    projectsEdit: false,
    feedbackReview: false,
    timesheetsEdit: false,
  },
  manager: {
    staffEdit: true,
    staffViewCompensation: true,
    ptoReview: true,
    crmEdit: true,
    projectsEdit: true,
    feedbackReview: true,
    timesheetsEdit: true,
  },
  admin: {
    staffEdit: true,
    staffViewCompensation: true,
    ptoReview: true,
    crmEdit: true,
    projectsEdit: true,
    feedbackReview: true,
    timesheetsEdit: true,
  },
};

describe("permission matrix", () => {
  for (const role of Object.keys(MATRIX) as AppRole[]) {
    const expected = MATRIX[role];

    test(`${role}: staff.edit === ${expected.staffEdit}`, () => {
      expect(userHasPermission({ role }, { staff: ["edit"] })).toBe(
        expected.staffEdit,
      );
    });

    test(`${role}: staff.viewCompensation === ${expected.staffViewCompensation}`, () => {
      expect(userHasPermission({ role }, { staff: ["viewCompensation"] })).toBe(
        expected.staffViewCompensation,
      );
    });

    test(`${role}: pto.review === ${expected.ptoReview}`, () => {
      expect(userHasPermission({ role }, { pto: ["review"] })).toBe(
        expected.ptoReview,
      );
    });

    test(`${role}: crm.edit === ${expected.crmEdit}`, () => {
      expect(userHasPermission({ role }, { crm: ["edit"] })).toBe(
        expected.crmEdit,
      );
    });

    test(`${role}: projects.edit === ${expected.projectsEdit}`, () => {
      expect(userHasPermission({ role }, { projects: ["edit"] })).toBe(
        expected.projectsEdit,
      );
    });

    test(`${role}: feedback.review === ${expected.feedbackReview}`, () => {
      expect(userHasPermission({ role }, { feedback: ["review"] })).toBe(
        expected.feedbackReview,
      );
    });

    test(`${role}: timesheets.edit === ${expected.timesheetsEdit}`, () => {
      expect(userHasPermission({ role }, { timesheets: ["edit"] })).toBe(
        expected.timesheetsEdit,
      );
    });
  }

  test("roles map covers exactly the canonical role set", () => {
    expect(Object.keys(roles).sort()).toEqual(Object.keys(MATRIX).sort());
  });
});

describe("role fallbacks (least privilege)", () => {
  test("null role grants nothing", () => {
    expect(userHasPermission({ role: null }, { staff: ["edit"] })).toBe(false);
    expect(userHasPermission({ role: null }, { pto: ["review"] })).toBe(false);
  });

  test("undefined role grants nothing", () => {
    expect(userHasPermission({}, { staff: ["edit"] })).toBe(false);
  });

  test("unknown role falls back to no permissions", () => {
    expect(userHasPermission({ role: "wizard" }, { staff: ["edit"] })).toBe(
      false,
    );
    expect(userHasPermission({ role: "wizard" }, { pto: ["review"] })).toBe(
      false,
    );
  });
});

describe("requirePermission", () => {
  test("returns silently when permitted", () => {
    expect(() =>
      requirePermission({ role: "manager" }, { staff: ["edit"] }),
    ).not.toThrow();
  });

  test("throws a user-safe error when denied", () => {
    expect(() =>
      requirePermission({ role: "user" }, { staff: ["edit"] }),
    ).toThrow(UserSafeActionError);
  });
});
