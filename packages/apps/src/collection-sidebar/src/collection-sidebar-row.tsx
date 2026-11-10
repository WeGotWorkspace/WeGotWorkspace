import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import { sidebarSelectMarker } from "@/workspace-shell/src/sidebar-breakpoint";
import { VisibilityDot } from "./visibility-dot";
import "./collection-sidebar-row.css";

const NESTED_ROW_CONTROL = "button, a, input, [role='button']";

/** Keep trailing/leading menus clickable without also selecting the row. */
function stopIfNestedControl(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest(NESTED_ROW_CONTROL);
  if (control && event.currentTarget.contains(control) && control !== event.currentTarget) {
    event.stopPropagation();
  }
}

export const COLLECTION_SIDEBAR_ROW_BLOCK = "collection-sidebar-row";

export type CollectionSidebarRowProps = {
  name: string;
  color: string;
  selected?: boolean;
  visible?: boolean;
  /** Independent of `onSelect`. Omit to hide the visibility checkbox. */
  onToggleVisibility?: () => void;
  /** Visibility toggle's accessible name; default "Show {name}" / "Hide {name}". */
  visibilityLabel?: string;
  /** Independent of `onToggleVisibility`. Calendar: create-target only. */
  onSelect?: () => void;
  onEdit?: () => void;
  editLabel?: string;
  /** Leading mark in the shared leading column (e.g. a group icon). */
  leading?: ReactNode;
  /** Inline before the name, inside the select button (e.g. a person's avatar). */
  nameLeading?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  /** Child under a parent collection (e.g. contacts group under a book). No extra indent. */
  nested?: boolean;
  /** Parent of the active nested row — lighter accent wash, not selected. */
  related?: boolean;
  /** Fold state when {@link onToggleExpand} is set. Default expanded. */
  expanded?: boolean;
  /** Independent of `onSelect`. Omit to hide the fold toggle. */
  onToggleExpand?: () => void;
  expandLabel?: string;
  showColorDot?: boolean;
  /**
   * Extra BEM block applied alongside {@link COLLECTION_SIDEBAR_ROW_BLOCK}.
   * Calendar keeps `calendar-sidebar-row` so existing selectors still match.
   */
  blockName?: string;
  className?: string;
  rootProps?: HTMLAttributes<HTMLLIElement>;
};

function rowBlocks(blockName: string): string[] {
  return blockName === COLLECTION_SIDEBAR_ROW_BLOCK
    ? [COLLECTION_SIDEBAR_ROW_BLOCK]
    : [COLLECTION_SIDEBAR_ROW_BLOCK, blockName];
}

function bem(blocks: string[], suffix = ""): string {
  return blocks.map((block) => `${block}${suffix}`).join(" ");
}

/** Shared view-only / subscription mark. Hover-edit lives on the row, not here. */
export function CollectionSidebarMark({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(`${COLLECTION_SIDEBAR_ROW_BLOCK}__mark`, className)}
          role="img"
          aria-label={label}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CollectionSidebarRow({
  name,
  color,
  selected = false,
  visible = true,
  onToggleVisibility,
  visibilityLabel,
  onSelect,
  onEdit,
  editLabel = "Edit",
  leading,
  nameLeading,
  badges,
  trailing,
  nested = false,
  related = false,
  expanded = true,
  onToggleExpand,
  expandLabel,
  showColorDot = false,
  blockName = COLLECTION_SIDEBAR_ROW_BLOCK,
  className,
  rootProps,
}: CollectionSidebarRowProps) {
  const blocks = rowBlocks(blockName);
  const showColorDotLeading = showColorDot && !onToggleVisibility;
  const hasLeading = Boolean(onToggleVisibility || leading || showColorDotLeading);
  return (
    <li
      {...rootProps}
      className={cn(
        bem(blocks),
        selected && bem(blocks, "--selected"),
        nested && bem(blocks, "--nested"),
        related && !selected && bem(blocks, "--related"),
        className,
        rootProps?.className,
      )}
      style={
        {
          "--collection-row-color": color || "var(--color-we-got-dark)",
          "--calendar-row-color": color || "var(--color-we-got-dark)",
          ...rootProps?.style,
        } as CSSProperties
      }
    >
      {/* Fixed-width leading column (visibility dot / icon / color-dot) so labels share one x. */}
      {hasLeading ? (
        <span className={bem(blocks, "__leading")}>
          {onToggleVisibility ? (
            /* Suite norm: a coloured dot, grey while the collection is hidden. */
            <VisibilityDot
              checked={visible}
              label={visibilityLabel ?? `${visible ? "Hide" : "Show"} ${name}`}
              onToggle={onToggleVisibility}
              className={bem(blocks, "__visibility")}
              dotClassName={bem(blocks, "__visibility-dot")}
            />
          ) : null}
          {showColorDotLeading ? <span className={bem(blocks, "__dot")} aria-hidden /> : null}
          {leading ? (
            <span
              className={bem(blocks, "__leading-mark")}
              aria-hidden
              onClick={stopIfNestedControl}
            >
              {leading}
            </span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        className={bem(blocks, "__select")}
        onClick={() => onSelect?.()}
        {...(onSelect ? sidebarSelectMarker : undefined)}
      >
        <span className={bem(blocks, "__title")}>
          {nameLeading ? (
            <span className={bem(blocks, "__name-leading")} aria-hidden>
              {nameLeading}
            </span>
          ) : null}
          <span className={bem(blocks, "__name")}>{name}</span>
          {badges}
        </span>
        {trailing ? (
          <span className={bem(blocks, "__trailing")} onClick={stopIfNestedControl}>
            {trailing}
          </span>
        ) : null}
      </button>
      {onEdit ? (
        <IconButton
          label={editLabel}
          icon={<Pencil className="size-3.5" aria-hidden />}
          size="xs"
          variant="ghost"
          className={`${bem(blocks, "__action")} ${bem(blocks, "__edit")}`}
          onClick={() => onEdit()}
        />
      ) : null}
      {onToggleExpand ? (
        <IconButton
          label={expandLabel ?? (expanded ? `Collapse ${name}` : `Expand ${name}`)}
          icon={
            expanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )
          }
          size="xs"
          variant="ghost"
          className={bem(blocks, "__expand")}
          aria-expanded={expanded}
          onClick={() => onToggleExpand()}
        />
      ) : null}
    </li>
  );
}
