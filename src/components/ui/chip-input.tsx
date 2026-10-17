import { useId, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  /** The input's accessible name. */
  label: string;
  placeholder?: string;
  removeLabel: (value: string) => string;
  /** Cleans a draft before it is added, e.g. strips characters a value may not hold. */
  normalize?: (draft: string) => string;
  suggestions?: string[];
};

const MAX_SUGGESTIONS = 6;

/** A field of removable chips with a text input at the end. Enter or blur adds
 *  the draft, Backspace on an empty draft removes the last chip. */
export function ChipInput({ values, onChange, label, placeholder, removeLabel, normalize, suggestions }: Props) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  // -1 means no suggestion is highlighted, so Enter adds exactly what was typed.
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();

  const query = draft.trim().toLowerCase();
  const matches =
    suggestions && query
      ? suggestions
          .filter((value) => value.toLowerCase().includes(query) && value.toLowerCase() !== query && !values.includes(value))
          .slice(0, MAX_SUGGESTIONS)
      : [];
  const open = focused && !dismissed && matches.length > 0;
  const current = open && active >= 0 ? Math.min(active, matches.length - 1) : -1;
  const highlighted = matches[current];

  const add = (raw: string) => {
    const value = (normalize ? normalize(raw) : raw).trim();
    setDraft("");
    setActive(-1);
    if (value && !values.includes(value)) onChange([...values, value]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME composition; it must not also add the half-typed text.
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        add(highlighted ?? draft);
        break;
      case "Tab":
        if (highlighted === undefined) break;
        event.preventDefault();
        add(highlighted);
        break;
      case "ArrowDown":
      case "ArrowUp": {
        if (matches.length === 0) break;
        event.preventDefault();
        setDismissed(false);
        const step = event.key === "ArrowDown" ? 1 : -1;
        // Cycles through the suggestions plus one "none" slot at -1.
        const slots = matches.length + 1;
        setActive((previous) => ((previous + 1 + step + slots) % slots) - 1);
        break;
      }
      case "Escape":
        if (!open) break;
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        setActive(-1);
        break;
      case "Backspace":
        if (!draft && values.length > 0) onChange(values.slice(0, -1));
        break;
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-muted p-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring-soft">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(values.filter((other) => other !== value))}
            className="inline-flex h-6 items-center gap-1 rounded-xs bg-surface-2 pr-1 pl-2 text-xs text-foreground transition-colors hover:bg-surface-3"
            aria-label={removeLabel(value)}
          >
            {value}
            <XIcon size={12} aria-hidden className="text-muted-foreground" />
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(-1);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            add(draft);
          }}
          placeholder={values.length ? "" : placeholder}
          aria-label={label}
          role={suggestions ? "combobox" : undefined}
          aria-expanded={suggestions ? open : undefined}
          aria-controls={suggestions ? listId : undefined}
          aria-autocomplete={suggestions ? "list" : undefined}
          aria-activedescendant={highlighted === undefined ? undefined : `${listId}-${current}`}
          className="h-6 min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-subtle-foreground"
        />
      </div>
      {suggestions && open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="建议"
          className="absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-md border border-border bg-popover p-1 text-popover-foreground"
        >
          {matches.map((value, index) => (
            <li
              key={value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              // Keeps focus in the input, so the blur handler does not add the draft first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(value)}
              onMouseMove={() => setActive(index)}
              className={cn(
                "flex h-7 cursor-default items-center rounded-sm px-2 text-sm text-foreground",
                index === current && "bg-accent",
              )}
            >
              {value}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
