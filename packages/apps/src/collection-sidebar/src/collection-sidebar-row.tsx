import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Checkbox } from "@/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import "./collection-sidebar-row.css";

export const COLLECTION_SIDEBAR_ROW_BLOCK = "collection-sidebar-row";

export type CollectionSidebarRowProps = {
  name: string;
  color: string;
  selected?: boolean;
  visible?: boolean;
  /** Independent of `onSelect`. Omit to hide the visibility checkbox. */
  onToggleVisibility?: () => void;
  /** Independent of `onToggleVisibility`. Calendar: create-target only. */
  onSelect?: () => void;
  onEdit?: () => void;
  editLabel?: string;
  /** Leading mark inside the select control (e.g. a group icon). */
  leading?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  /** Indent under a parent collection (contacts groups under a book). */
  nested?: boolean;
  /** Parent of the active nested row — related wash, not selected. */
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
  onSelect,
  onEdit,
  editLabel = "Edit",
  leading,
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
          "--collection-row-color": color || "var(--color-ink)",
          "--calendar-row-color": color || "var(--color-ink)",
          ...rootProps?.style,
        } as CSSProperties
      }
    >
      {onToggleVisibility ? (
        <Checkbox
          checked={visible}
          aria-label={`${visible ? "Hide" : "Show"} ${name}`}
          className={bem(blocks, "__visibility")}
          onCheckedChange={() => onToggleVisibility()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : showColorDot ? (
        <span className={bem(blocks, "__dot")} aria-hidden />
      ) : null}
      <button type="button" className={bem(blocks, "__select")} onClick={() => onSelect?.()}>
        {leading ? (
          <span className={bem(blocks, "__leading")} aria-hidden>
            {leading}
          </span>
        ) : null}
        <span className={bem(blocks, "__title")}>
          <span className={bem(blocks, "__name")}>{name}</span>
          {badges}
        </span>
        {trailing}
      </button>
      {onEdit ? (
        <IconButton
          label={editLabel}
          icon={<Pencil className="size-3.5" aria-hidden />}
          size="sm"
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
          size="sm"
          variant="ghost"
          className={bem(blocks, "__expand")}
          aria-expanded={expanded}
          onClick={() => onToggleExpand()}
        />
      ) : null}
    </li>
  );
}
