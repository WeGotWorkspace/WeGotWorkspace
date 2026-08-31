import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./tag.css";

/** `md` matches the compact chip used in footers/stats; `lg` is 28px for interactive editors. */
export type TagSize = "md" | "lg";

export type TagProps = {
  label: string;
  icon?: ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  removeAriaLabel?: string;
  /** Visual density. Default `md` keeps footer/stat chips compact. */
  size?: TagSize;
  colors?: {
    backgroundColor?: string;
    color?: string;
  };
  className?: string;
};

export function Tag({
  label,
  icon,
  removable = false,
  onRemove,
  removeAriaLabel,
  size = "md",
  colors,
  className,
}: TagProps) {
  const tagStyle: CSSProperties | undefined = colors
    ? ({
        "--tag-bg":
          colors.backgroundColor ?? "color-mix(in oklab, var(--color-ink) 8%, transparent)",
        "--tag-fg": colors.color ?? "var(--color-ink)",
      } as CSSProperties)
    : undefined;

  return (
    <span className={cn("tag group", size === "lg" && "tag--size-lg", className)} style={tagStyle}>
      {icon ? <span className="tag__icon">{icon}</span> : null}
      <span className="truncate">{label}</span>
      {removable && onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
              aria-label={removeAriaLabel ?? `Remove ${label}`}
              className="tag__remove"
            >
              <X />
            </button>
          </TooltipTrigger>
          <TooltipContent>{removeAriaLabel ?? `Remove ${label}`}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

export type TagGroupProps = {
  tags: string[];
  /** When `false`, tags are removable and an add control is shown when `onAddTag` is set. */
  readonly?: boolean;
  /**
   * Existing tags offered as autocomplete suggestions when adding.
   * Already-applied tags are excluded automatically.
   */
  suggestions?: string[];
  /** Called when the user confirms a tag via the inline add field. */
  onAddTag?: (label: string) => void;
  /** Called with the tag label when a tag is removed. */
  onRemoveTag?: (label: string) => void;
  addPlaceholder?: string;
  addAriaLabel?: string;
  /** Density for chips + add control. Default `md` keeps compact call sites unchanged. */
  size?: TagSize;
  tagColors?: TagProps["colors"];
  className?: string;
  style?: CSSProperties;
};

type TagSuggestion = {
  id: string;
  label: string;
  create: boolean;
};

function buildTagSuggestions(
  query: string,
  suggestions: string[],
  applied: ReadonlySet<string>,
): TagSuggestion[] {
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const filtered = suggestions
    .filter((tag) => !applied.has(tag))
    .filter((tag) => !q || tag.toLowerCase().includes(q))
    .map((tag) => ({ id: `existing:${tag}`, label: tag, create: false }));

  const exactMatch = suggestions.some((tag) => tag.toLowerCase() === q);
  const canCreate = !!trimmed && !exactMatch && !applied.has(trimmed);
  if (canCreate) {
    filtered.push({ id: `create:${trimmed}`, label: trimmed, create: true });
  }
  return filtered;
}

function TagAddField({
  suggestions,
  appliedTags,
  placeholder,
  ariaLabel,
  onConfirm,
  onCancel,
}: {
  suggestions: string[];
  appliedTags: string[];
  placeholder: string;
  ariaLabel: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const applied = new Set(appliedTags);
  const options = buildTagSuggestions(query, suggestions, applied);
  const showList = options.length > 0;
  const activeOption = options[highlight] ?? null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const commit = (label: string) => {
    const value = label.trim();
    if (!value || applied.has(value)) {
      onCancel();
      return;
    }
    onConfirm(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlight((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlight((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption) {
        commit(activeOption.label);
        return;
      }
      const trimmed = query.trim();
      if (trimmed) commit(trimmed);
      else onCancel();
    }
  };

  return (
    <div className="tag-group__add">
      <input
        ref={inputRef}
        type="text"
        className="tag-group__input"
        value={query}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!query.trim()) onCancel();
        }}
      />
      {showList ? (
        <ul id={listId} className="tag-group__suggestions" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => {
            const active = index === highlight;
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={active}
                  className={cn("tag-group__suggestion", active && "tag-group__suggestion--active")}
                  onMouseDown={(event) => {
                    // Keep focus until commit; avoid blur-cancel racing the click.
                    event.preventDefault();
                    commit(option.label);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  {option.create ? `Create “${option.label}”` : option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function TagGroup({
  tags,
  readonly = true,
  suggestions = [],
  onAddTag,
  onRemoveTag,
  addPlaceholder = "Add tag…",
  addAriaLabel = "Add tag",
  size = "md",
  tagColors,
  className,
  style,
}: TagGroupProps) {
  const [adding, setAdding] = useState(false);
  const canAdd = !readonly && !!onAddTag;

  const closeAdd = () => setAdding(false);

  return (
    <div
      className={cn("tag-group", size === "lg" && "tag-group--size-lg", className)}
      style={style}
    >
      {tags.map((t) => (
        <Tag
          key={t}
          label={t}
          icon={<TagIcon />}
          size={size}
          colors={tagColors}
          removable={!readonly}
          onRemove={readonly || !onRemoveTag ? undefined : () => onRemoveTag(t)}
          removeAriaLabel={`Remove tag ${t}`}
        />
      ))}
      {canAdd && adding ? (
        <TagAddField
          suggestions={suggestions}
          appliedTags={tags}
          placeholder={addPlaceholder}
          ariaLabel={addAriaLabel}
          onConfirm={(label) => {
            onAddTag(label);
            closeAdd();
          }}
          onCancel={closeAdd}
        />
      ) : null}
      {canAdd && !adding ? (
        <button
          type="button"
          className="tag-group__add-button"
          aria-label={addAriaLabel}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          <span>{addAriaLabel}</span>
        </button>
      ) : null}
    </div>
  );
}
