import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Pencil } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Checkbox } from "@/ui/checkbox";
import { cn } from "@/lib/utils";
import "./collection-sidebar-row.css";

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
  badges?: ReactNode;
  trailing?: ReactNode;
  showColorDot?: boolean;
  /** BEM block. Calendar passes `calendar-sidebar-row` to keep existing CSS. */
  blockName?: string;
  className?: string;
  rootProps?: HTMLAttributes<HTMLLIElement>;
};

export function CollectionSidebarRow({
  name,
  color,
  selected = false,
  visible = true,
  onToggleVisibility,
  onSelect,
  onEdit,
  editLabel = "Edit",
  badges,
  trailing,
  showColorDot = false,
  blockName = "collection-sidebar-row",
  className,
  rootProps,
}: CollectionSidebarRowProps) {
  return (
    <li
      {...rootProps}
      className={cn(
        blockName,
        selected && `${blockName}--selected`,
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
          className={`${blockName}__visibility`}
          onCheckedChange={() => onToggleVisibility()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : showColorDot ? (
        <span className={`${blockName}__dot`} aria-hidden />
      ) : null}
      <button type="button" className={`${blockName}__select`} onClick={() => onSelect?.()}>
        <span className={`${blockName}__title`}>
          <span className={`${blockName}__name`}>{name}</span>
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
          className={`${blockName}__action ${blockName}__edit`}
          onClick={() => onEdit()}
        />
      ) : null}
    </li>
  );
}
