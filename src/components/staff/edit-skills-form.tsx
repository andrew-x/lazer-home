"use client";

import {
  IconChevronDown,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { updateStaffSkills } from "@/actions/staff/updateStaffSkills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  PROFICIENCY_LABELS,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
  SKILL_CATEGORIES,
  type StaffSkill,
} from "@/lib/skills";
import { cn } from "@/lib/utils";

/**
 * Dedicated skills editor. Pick a level with the "Add as" selector, then click
 * skills from the searchable catalogue to add them at that level — so a batch of
 * same-level skills is a few clicks. Chosen skills group under their level, each
 * removable (✕) or re-levelable (▾) in place. Saves the whole list via
 * `updateStaffSkills`, then returns to the profile.
 */
export function EditSkillsForm({
  staffId,
  initialSkills,
}: {
  staffId: string;
  initialSkills: StaffSkill[];
}) {
  const router = useRouter();
  const [skills, setSkills] = useState<StaffSkill[]>(initialSkills);
  const [addAs, setAddAs] = useState<ProficiencyLevel>("intermediate");
  const [query, setQuery] = useState("");

  const { execute, isExecuting, result } = useAction(updateStaffSkills, {
    onSuccess: () => router.push(`/staff/${staffId}`),
  });

  const chosen = useMemo(
    () => new Set(skills.map((skill) => skill.name)),
    [skills],
  );

  function addSkill(name: string) {
    setSkills((current) =>
      current.some((skill) => skill.name === name)
        ? current
        : [...current, { name, level: addAs }],
    );
  }

  function removeSkill(name: string) {
    setSkills((current) => current.filter((skill) => skill.name !== name));
  }

  function setLevel(name: string, level: ProficiencyLevel) {
    setSkills((current) =>
      current.map((skill) =>
        skill.name === name ? { ...skill, level } : skill,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SelectedSkills
        skills={skills}
        onRemove={removeSkill}
        onSetLevel={setLevel}
      />

      <AddSkills
        chosen={chosen}
        addAs={addAs}
        onAddAsChange={setAddAs}
        query={query}
        onQueryChange={setQuery}
        onAdd={addSkill}
      />

      {result.serverError ? (
        <p className="text-sm text-destructive">{result.serverError}</p>
      ) : null}

      <div className="flex items-center gap-2 border-t pt-4">
        <Button
          type="button"
          onClick={() => execute({ staffId, skills })}
          disabled={isExecuting}
        >
          {isExecuting ? "Saving…" : "Save skills"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/staff/${staffId}`)}
          disabled={isExecuting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The chosen skills, grouped by level; each chip removable and re-levelable. */
function SelectedSkills({
  skills,
  onRemove,
  onSetLevel,
}: {
  skills: StaffSkill[];
  onRemove: (name: string) => void;
  onSetLevel: (name: string, level: ProficiencyLevel) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-heading text-sm font-semibold tracking-tight">
          Your skills
        </h3>
        <span className="text-xs text-muted-foreground">
          {skills.length} {skills.length === 1 ? "skill" : "skills"}
        </span>
      </div>

      {skills.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No skills yet. Pick some from the catalogue below to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {PROFICIENCY_LEVELS.map((level) => {
            const atLevel = skills.filter((skill) => skill.level === level);
            if (atLevel.length === 0) return null;
            return (
              <div key={level} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {PROFICIENCY_LABELS[level]}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {atLevel.map((skill) => (
                    <SelectedChip
                      key={skill.name}
                      skill={skill}
                      onRemove={() => onRemove(skill.name)}
                      onSetLevel={(next) => onSetLevel(skill.name, next)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** One chosen skill: name opens a level menu (▾); the trailing ✕ removes it. */
function SelectedChip({
  skill,
  onRemove,
  onSetLevel,
}: {
  skill: StaffSkill;
  onRemove: () => void;
  onSetLevel: (level: ProficiencyLevel) => void;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-0.5 rounded-4xl bg-secondary pr-0.5 pl-2 text-xs font-medium text-secondary-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Change level for ${skill.name}`}
              className="inline-flex items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {skill.name}
              <IconChevronDown className="size-3 text-muted-foreground" />
            </button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={skill.level}
            onValueChange={(value) => onSetLevel(value as ProficiencyLevel)}
          >
            {PROFICIENCY_LEVELS.map((level) => (
              <DropdownMenuRadioItem key={level} value={level}>
                {PROFICIENCY_LABELS[level]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <IconX />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Remove ${skill.name}`}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <IconX className="size-3" />
      </button>
    </span>
  );
}

/** Level selector + searchable catalogue of not-yet-chosen skills. */
function AddSkills({
  chosen,
  addAs,
  onAddAsChange,
  query,
  onQueryChange,
  onAdd,
}: {
  chosen: Set<string>;
  addAs: ProficiencyLevel;
  onAddAsChange: (level: ProficiencyLevel) => void;
  query: string;
  onQueryChange: (next: string) => void;
  onAdd: (name: string) => void;
}) {
  const trimmed = query.trim().toLowerCase();

  // Available (unchosen) skills, filtered by the search, grouped by dimension.
  const groups = useMemo(
    () =>
      SKILL_CATEGORIES.map((category) => ({
        name: category.name,
        skills: category.skills.filter(
          (skill) =>
            !chosen.has(skill) &&
            (trimmed === "" || skill.toLowerCase().includes(trimmed)),
        ),
      })).filter((group) => group.skills.length > 0),
    [chosen, trimmed],
  );

  const totalAvailable = groups.reduce(
    (n, group) => n + group.skills.length,
    0,
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">Add as</span>
        <div className="inline-flex rounded-lg border p-0.5">
          {PROFICIENCY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onAddAsChange(level)}
              aria-pressed={addAs === level}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                addAs === level
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PROFICIENCY_LABELS[level]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search skills…"
          className="pl-8"
          aria-label="Search skills"
        />
      </div>

      {totalAvailable === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {trimmed === ""
            ? "Every catalogue skill has been added."
            : `No skills match “${query.trim()}”.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.name} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {group.name}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {group.skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="outline"
                    className="gap-0.5 py-1 pr-2 pl-1.5 text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                    render={
                      <button type="button" onClick={() => onAdd(skill)} />
                    }
                  >
                    <IconPlus className="size-3" />
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
