"use client";

import { useMemo } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/**
 * A free-text input with a suggestion dropdown: whatever the user types **is**
 * the value, and the list is only a shortcut. Deliberately different from
 * `EntityCombobox`, which holds an `{ id, name }` picked from a server search and
 * therefore can't represent a value the search didn't return.
 *
 * `value` drives both `value` (so the matching suggestion shows its checkmark)
 * and `inputValue` (the text), keeping the two in lock-step. Controlling
 * `inputValue` is what makes freeform entry safe: Base UI's "reset the input to
 * the selected item's label" effects are both guarded on the input being
 * *un*controlled, so a novel entry like "Fractional CTO" can't snap back on
 * blur or Escape.
 *
 * Built-in filtering stays **on** (no `filter={null}`) — the items are a local
 * list, so there's no server round-trip to debounce.
 *
 * **Typed text appears as its own option** (`Use “…”`) whenever it isn't already
 * one of the suggestions. That's the affordance that makes "you may write your own
 * wording" discoverable — an empty dropdown saying so is easy to miss, and leaves
 * the user unsure whether the field will accept what they typed. It always
 * survives the filter, since an item trivially contains its own query.
 */
export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  invalid = false,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  invalid?: boolean;
}) {
  // The typed value as a selectable option, or null when there's nothing to add:
  // blank input, or text that already *is* a suggestion (case-insensitively, so
  // typing "csm" offers only the canonical "CSM" rather than both).
  const customOption = useMemo(() => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const matchesSuggestion = suggestions.some(
      (suggestion) => suggestion.toLowerCase() === trimmed.toLowerCase(),
    );
    return matchesSuggestion ? null : trimmed;
  }, [value, suggestions]);

  // Appended, not prepended: the curated list stays the first thing scanned, and
  // the custom row reads as the fallback it is.
  const items = useMemo(
    () =>
      customOption === null ? suggestions : [...suggestions, customOption],
    [suggestions, customOption],
  );

  return (
    <Combobox
      items={items}
      value={value}
      inputValue={value}
      // Both paths converge on one setter: typing fires `onInputValueChange`,
      // and pressing a suggestion fires `onValueChange` *and* has Base UI fill
      // the input (which fires `onInputValueChange` too). Pressing the custom row
      // therefore normalises the field to the trimmed text.
      onValueChange={(next: string | null) => onChange(next ?? "")}
      onInputValueChange={(next: string) => onChange(next)}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
      />
      <ComboboxContent>
        {/* Near-unreachable now (the custom row always matches its own query) —
            kept for the no-suggestions-and-no-input case. */}
        <ComboboxEmpty>No suggestions.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item === customOption ? (
                <>
                  <span className="text-muted-foreground">Use</span>{" "}
                  <span className="font-medium">“{item}”</span>
                </>
              ) : (
                item
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
