"use client";

import { FilterLabel } from "@/components/form/filters";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { SKILL_CATEGORIES } from "@/lib/staff/skills";

/** The skill catalogue shaped as Base UI Combobox groups (label + items). */
const SKILL_GROUPS = SKILL_CATEGORIES.map((category) => ({
  value: category.name,
  items: [...category.skills],
}));

/**
 * A grouped, searchable multi-select of catalogue skills, shown as chips. Shared
 * by the staff directory and the allocations planner filter bars — both narrow a
 * staff list by skills the same way (pair with `matchesSkillFilter`).
 */
export function SkillsFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const anchor = useComboboxAnchor();
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>Skills</FilterLabel>
      <Combobox
        multiple
        items={SKILL_GROUPS}
        value={value}
        onValueChange={onChange}
      >
        <ComboboxChips ref={anchor} className="w-full">
          {value.map((skill) => (
            <ComboboxChip key={skill} aria-label={skill}>
              {skill}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput
            placeholder={value.length === 0 ? "Search skills…" : ""}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No skills found.</ComboboxEmpty>
          <ComboboxList>
            {(group: { value: string; items: string[] }) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(skill: string) => (
                    <ComboboxItem key={skill} value={skill}>
                      {skill}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
