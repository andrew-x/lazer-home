import { describe, expect, test } from "bun:test";
import {
  matchesSkillFilter,
  meetsMinimumLevel,
  type StaffSkill,
} from "@/lib/skills";

const skills: StaffSkill[] = [
  { name: "React", level: "senior" },
  { name: "TypeScript", level: "intermediate" },
  { name: "Rust", level: "learning" },
];

describe("meetsMinimumLevel", () => {
  test("a level meets itself", () => {
    expect(meetsMinimumLevel("intermediate", "intermediate")).toBe(true);
  });

  test("a higher level meets a lower minimum", () => {
    expect(meetsMinimumLevel("senior", "intermediate")).toBe(true);
    expect(meetsMinimumLevel("intermediate", "learning")).toBe(true);
  });

  test("a lower level does not meet a higher minimum", () => {
    expect(meetsMinimumLevel("intermediate", "senior")).toBe(false);
    expect(meetsMinimumLevel("learning", "intermediate")).toBe(false);
  });
});

describe("matchesSkillFilter", () => {
  test("empty required list matches everyone", () => {
    expect(matchesSkillFilter(skills, [])).toBe(true);
    expect(matchesSkillFilter([], [])).toBe(true);
  });

  test("matches when the person holds every required skill (no minimum)", () => {
    expect(matchesSkillFilter(skills, ["React", "Rust"])).toBe(true);
  });

  test("rejects when any required skill is missing (AND semantics)", () => {
    expect(matchesSkillFilter(skills, ["React", "Go"])).toBe(false);
  });

  test("intermediate+ minimum excludes a learning-level skill", () => {
    expect(matchesSkillFilter(skills, ["TypeScript"], "intermediate")).toBe(
      true,
    );
    expect(matchesSkillFilter(skills, ["Rust"], "intermediate")).toBe(false);
  });

  test("senior minimum only matches senior-level skills", () => {
    expect(matchesSkillFilter(skills, ["React"], "senior")).toBe(true);
    expect(matchesSkillFilter(skills, ["TypeScript"], "senior")).toBe(false);
  });

  test("every required skill must independently meet the minimum", () => {
    // React is senior, TypeScript is only intermediate → fails a senior bar.
    expect(matchesSkillFilter(skills, ["React", "TypeScript"], "senior")).toBe(
      false,
    );
    expect(
      matchesSkillFilter(skills, ["React", "TypeScript"], "intermediate"),
    ).toBe(true);
  });
});
