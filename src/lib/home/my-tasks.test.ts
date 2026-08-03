import { describe, expect, test } from "bun:test";
import type { MyTaskView } from "@/actions/crm/getMyTasks";
import {
  applyDoneOverrides,
  filterMyTasks,
  isStaleTask,
  mergeMyTasks,
  STALE_TASK_DAYS,
  sortMyTasksByRecency,
  taskAgeDays,
} from "@/lib/home/my-tasks";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A task assigned `days` ago. */
function daysAgo(days: number): number {
  return NOW - days * MS_PER_DAY;
}

function task(overrides: Partial<MyTaskView> = {}): MyTaskView {
  return {
    id: "task-1",
    description: "Send the revised statement of work",
    done: false,
    createdAt: daysAgo(1),
    completedAt: null,
    parentKind: "company",
    parentId: "company-1",
    parentName: "Acme",
    ...overrides,
  };
}

describe("taskAgeDays", () => {
  test("counts whole days elapsed", () => {
    expect(taskAgeDays(daysAgo(0), NOW)).toBe(0);
    expect(taskAgeDays(daysAgo(1), NOW)).toBe(1);
    expect(taskAgeDays(daysAgo(30), NOW)).toBe(30);
  });

  test("floors a partial day rather than rounding up", () => {
    expect(taskAgeDays(NOW - MS_PER_DAY * 1.9, NOW)).toBe(1);
  });

  test("never goes negative for a clock skew into the future", () => {
    expect(taskAgeDays(NOW + MS_PER_DAY, NOW)).toBe(0);
  });
});

describe("isStaleTask", () => {
  test("flags an open task at or past the threshold", () => {
    expect(
      isStaleTask(task({ createdAt: daysAgo(STALE_TASK_DAYS) }), NOW),
    ).toBe(true);
    expect(isStaleTask(task({ createdAt: daysAgo(30) }), NOW)).toBe(true);
  });

  test("leaves an open task below the threshold alone", () => {
    expect(
      isStaleTask(task({ createdAt: daysAgo(STALE_TASK_DAYS - 1) }), NOW),
    ).toBe(false);
    expect(isStaleTask(task({ createdAt: daysAgo(0) }), NOW)).toBe(false);
  });

  test("never flags a completed task, however old", () => {
    expect(
      isStaleTask(
        task({ createdAt: daysAgo(300), done: true, completedAt: daysAgo(1) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("mergeMyTasks", () => {
  test("interleaves both lists newest-assigned first", () => {
    const open = [
      task({ id: "new-open", createdAt: daysAgo(1) }),
      task({ id: "old-open", createdAt: daysAgo(10) }),
    ];
    const completed = [
      task({ id: "mid-done", createdAt: daysAgo(5), done: true }),
    ];
    expect(mergeMyTasks(open, completed).map((row) => row.id)).toEqual([
      "new-open",
      "mid-done",
      "old-open",
    ]);
  });

  test("deduplicates by id, so a widened read can't double a row", () => {
    const row = task({ id: "dupe" });
    expect(mergeMyTasks([row], [row]).map((r) => r.id)).toEqual(["dupe"]);
  });

  test("handles both lists being empty", () => {
    expect(mergeMyTasks([], [])).toEqual([]);
  });
});

describe("applyDoneOverrides", () => {
  test("returns the input untouched with no overrides", () => {
    const rows = [task({ id: "a" })];
    expect(applyDoneOverrides(rows, new Map())).toEqual(rows);
  });

  test("marks a just-ticked task done", () => {
    const [row] = applyDoneOverrides(
      [task({ id: "a", done: false })],
      new Map([["a", true]]),
    );
    expect(row.done).toBe(true);
  });

  test("clears completedAt when a task is reopened", () => {
    const [row] = applyDoneOverrides(
      [task({ id: "a", done: true, completedAt: daysAgo(1) })],
      new Map([["a", false]]),
    );
    expect(row.done).toBe(false);
    expect(row.completedAt).toBeNull();
  });

  test("ignores an override that already agrees with the server", () => {
    const rows = [task({ id: "a", done: true, completedAt: daysAgo(1) })];
    expect(applyDoneOverrides(rows, new Map([["a", true]]))).toEqual(rows);
  });

  test("leaves tasks with no override alone", () => {
    const rows = [task({ id: "a" }), task({ id: "b" })];
    const result = applyDoneOverrides(rows, new Map([["a", true]]));
    expect(result[0].done).toBe(true);
    expect(result[1].done).toBe(false);
  });

  // The override has to reach the staleness flag too, not just the strike-through.
  test("a reopened old task reads as stale again", () => {
    const [row] = applyDoneOverrides(
      [task({ id: "a", createdAt: daysAgo(30), done: true })],
      new Map([["a", false]]),
    );
    expect(isStaleTask(row, NOW)).toBe(true);
  });
});

describe("filterMyTasks", () => {
  const tasks: MyTaskView[] = [
    task({ id: "a", description: "Call about renewal", parentName: "Acme" }),
    task({
      id: "b",
      description: "Draft the proposal",
      parentKind: "opportunity",
      parentId: "opportunity-1",
      parentName: "Globex Platform Rebuild",
    }),
    task({
      id: "c",
      description: "Chase the signature",
      parentKind: "contact",
      parentId: "contact-1",
      parentName: "Dana Reyes",
      done: true,
      completedAt: daysAgo(1),
    }),
  ];

  const ids = (rows: MyTaskView[]) => rows.map((row) => row.id);

  test("returns everything with no filters", () => {
    expect(ids(filterMyTasks(tasks))).toEqual(["a", "b", "c"]);
  });

  test("matches on the description, case-insensitively", () => {
    expect(ids(filterMyTasks(tasks, { query: "PROPOSAL" }))).toEqual(["b"]);
  });

  test("matches on the parent's name too, not just the description", () => {
    expect(ids(filterMyTasks(tasks, { query: "globex" }))).toEqual(["b"]);
    expect(ids(filterMyTasks(tasks, { query: "dana" }))).toEqual(["c"]);
  });

  test("ignores surrounding whitespace in the query", () => {
    expect(ids(filterMyTasks(tasks, { query: "  renewal  " }))).toEqual(["a"]);
  });

  test("narrows by parent kind", () => {
    expect(ids(filterMyTasks(tasks, { kind: "company" }))).toEqual(["a"]);
    expect(ids(filterMyTasks(tasks, { kind: "contact" }))).toEqual(["c"]);
  });

  test("narrows by completion state", () => {
    expect(ids(filterMyTasks(tasks, { status: "open" }))).toEqual(["a", "b"]);
    expect(ids(filterMyTasks(tasks, { status: "completed" }))).toEqual(["c"]);
  });

  test("combines every filter", () => {
    expect(
      ids(
        filterMyTasks(tasks, {
          query: "the",
          kind: "opportunity",
          status: "open",
        }),
      ),
    ).toEqual(["b"]);
    // Same query and kind, but the wrong status excludes it.
    expect(
      ids(
        filterMyTasks(tasks, {
          query: "the",
          kind: "opportunity",
          status: "completed",
        }),
      ),
    ).toEqual([]);
  });

  test("returns nothing when the query matches neither field", () => {
    expect(ids(filterMyTasks(tasks, { query: "invoice" }))).toEqual([]);
  });

  // keepIds is the accidental-click undo: a row toggled this visit must survive the
  // status filter its own toggle just contradicted, in the panel and the archive.
  describe("keepIds", () => {
    test("holds a completed task against a status:open filter", () => {
      expect(
        ids(filterMyTasks(tasks, { status: "open", keepIds: new Set(["c"]) })),
      ).toEqual(["a", "b", "c"]);
    });

    test("holds an open task against a status:completed filter", () => {
      expect(
        ids(
          filterMyTasks(tasks, {
            status: "completed",
            keepIds: new Set(["a"]),
          }),
        ),
      ).toEqual(["a", "c"]);
    });

    test("exempts from status only — search still hides a kept row", () => {
      expect(
        ids(
          filterMyTasks(tasks, {
            status: "open",
            query: "renewal",
            keepIds: new Set(["c"]),
          }),
        ),
      ).toEqual(["a"]);
    });

    test("exempts from status only — the kind filter still hides a kept row", () => {
      expect(
        ids(
          filterMyTasks(tasks, {
            status: "open",
            kind: "company",
            keepIds: new Set(["c"]),
          }),
        ),
      ).toEqual(["a"]);
    });

    test("an empty set changes nothing", () => {
      expect(
        ids(filterMyTasks(tasks, { status: "open", keepIds: new Set() })),
      ).toEqual(["a", "b"]);
    });
  });
});

describe("sortMyTasksByRecency", () => {
  test("puts the most recently completed first, ahead of newer-assigned rows", () => {
    const rows = [
      task({ id: "new-open", createdAt: daysAgo(2) }),
      task({
        id: "old-but-just-closed",
        createdAt: daysAgo(200),
        done: true,
        completedAt: daysAgo(1),
      }),
    ];
    // By assignment date this would sort last; by completion it leads.
    expect(sortMyTasksByRecency(rows).map((r) => r.id)).toEqual([
      "old-but-just-closed",
      "new-open",
    ]);
  });

  test("falls back to the assigned date for open tasks", () => {
    const rows = [
      task({ id: "older", createdAt: daysAgo(9) }),
      task({ id: "newer", createdAt: daysAgo(3) }),
    ];
    expect(sortMyTasksByRecency(rows).map((r) => r.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  test("does not mutate its input", () => {
    const rows = [
      task({ id: "a", createdAt: daysAgo(1) }),
      task({ id: "b", createdAt: daysAgo(5) }),
    ];
    sortMyTasksByRecency(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
