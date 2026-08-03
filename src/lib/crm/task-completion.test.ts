import { describe, expect, test } from "bun:test";
import { taskCompletionAllowed } from "@/lib/crm/task-completion";

describe("taskCompletionAllowed", () => {
  test("the assignee may complete their own task without crm.edit", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: false,
        ownerStaffId: "staff-1",
        callerStaffId: "staff-1",
      }),
    ).toBe(true);
  });

  test("someone else's task is denied without crm.edit", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: false,
        ownerStaffId: "staff-2",
        callerStaffId: "staff-1",
      }),
    ).toBe(false);
  });

  test("crm.edit completes anyone's task", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: true,
        ownerStaffId: "staff-2",
        callerStaffId: "staff-1",
      }),
    ).toBe(true);
  });

  test("an unassigned task needs crm.edit", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: false,
        ownerStaffId: null,
        callerStaffId: "staff-1",
      }),
    ).toBe(false);
    expect(
      taskCompletionAllowed({
        hasCrmEdit: true,
        ownerStaffId: null,
        callerStaffId: "staff-1",
      }),
    ).toBe(true);
  });

  test("a caller with no linked staff record is denied", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: false,
        ownerStaffId: "staff-1",
        callerStaffId: null,
      }),
    ).toBe(false);
  });

  // The load-bearing case: two nulls must not read as a match, or every
  // unassigned task would be completable by every unlinked account.
  test("two nulls are not a match", () => {
    expect(
      taskCompletionAllowed({
        hasCrmEdit: false,
        ownerStaffId: null,
        callerStaffId: null,
      }),
    ).toBe(false);
  });
});
