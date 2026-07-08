import { describe, expect, test } from "bun:test";
import { updateStaffSkillsSchema } from "./updateStaffSkills.schema";

describe("updateStaffSkillsSchema", () => {
  test("accepts a valid set of catalogue skills", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "staff_123",
      skills: [
        { name: "React", level: "senior" },
        { name: "Python", level: "intermediate" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts an empty skills list", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "staff_123",
      skills: [],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a skill not in the catalogue", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "staff_123",
      skills: [{ name: "Cobol", level: "senior" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects the same skill listed twice", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "staff_123",
      skills: [
        { name: "React", level: "senior" },
        { name: "React", level: "learning" },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown proficiency level", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "staff_123",
      skills: [{ name: "React", level: "expert" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing staffId", () => {
    const result = updateStaffSkillsSchema.safeParse({
      staffId: "",
      skills: [{ name: "React", level: "senior" }],
    });
    expect(result.success).toBe(false);
  });
});
