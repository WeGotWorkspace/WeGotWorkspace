import {
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import type { ControlSize } from "@/ui/control-size";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import "@/ui/collection-select.css";

/** Sentinel so "Create …" stays out of the selected value (Calendar Select pattern). */
export const COLLECTION_SELECT_CREATE_VALUE = "__create_collection__";

export type CollectionSelectItem = {
  id: string;
  /** The name as shown (already resolved, e.g. "Personal" for the default book). */
  name: string;
  /** The collection colour for its dot (`--collection-row-color`). */
  color: string;
};

export type CollectionSelectProps = {
  items: readonly CollectionSelectItem[];
  /** The selected item's id. */
  value: string;
  /** The collection's colour dot; it reads `--collection-row-color` from its row. */
  dot: ReactNode;
  /** The selected collection's colour (on the swatch and the ghost trigger). */
  color: string;
  /** Name on the ghost trigger. */
  triggerLabel: string;
  /** Accessible name of the trigger (and the tooltip text). */
  accessibleName: string;
  /**
   * `swatch` reuses ColorSwatchTrigger (dot + chevron, no caption) — same chrome as
   * the Calendar event picker. `labeled` is the Select trigger with the visible name.
   * `ghost` is the name in its own colour with a small chevron and no chrome (the
   * switcher above a detail title).
   */
  triggerVariant?: "labeled" | "swatch" | "ghost";
  size?: ControlSize;
  /** A labeled trigger takes its content width; off, it fills its field row. */
  fitLabeled?: boolean;
  /** A labeled trigger also shows its name in a tooltip. */
  labeledTooltip?: boolean;
  /** Classes on the trigger: the app's own hooks (`notes-notebook-select`, …). */
  className?: string;
  menuClassName?: string;
  id?: string;
  disabled?: boolean;
  /** "Create …" after a separator at the end of the menu. */
  create?: { label: string; onSelect: () => void };
  onValueChange: (id: string) => void;
  onTriggerKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onCloseAutoFocus?: (event: Event) => void;
};

function rowColor(color: string): CSSProperties {
  return { "--collection-row-color": color } as CSSProperties;
}

/**
 * A collection picker (Notes notebook, Contacts address book): each option is the
 * collection's dot and name, with a labeled, swatch or ghost trigger.
 */
export function CollectionSelect({
  items,
  value,
  dot,
  color,
  triggerLabel,
  accessibleName,
  triggerVariant = "labeled",
  size = "md",
  fitLabeled = true,
  labeledTooltip = true,
  className,
  menuClassName,
  id,
  disabled = false,
  create,
  onValueChange,
  onTriggerKeyDown,
  onCloseAutoFocus,
}: CollectionSelectProps): ReactElement {
  const swatch = triggerVariant === "swatch";
  const ghost = triggerVariant === "ghost";
  // The trigger tooltip would stay over the open list and catch clicks on the options below it.
  const [listOpen, setListOpen] = useState(false);

  const trigger = ghost ? (
    <CollectionGhostSelectTrigger
      id={id}
      className={cn("collection-select", "collection-select--ghost", className)}
      aria-label={accessibleName}
      disabled={disabled}
      onKeyDown={onTriggerKeyDown}
      style={rowColor(color)}
      leading={dot}
      label={triggerLabel}
    />
  ) : swatch ? (
    <SelectPrimitive.Trigger asChild disabled={disabled}>
      <ColorSwatchTrigger
        id={id}
        label={accessibleName}
        disabled={disabled}
        size={size}
        onKeyDown={onTriggerKeyDown}
        icon={
          <span className="collection-select__option" style={rowColor(color)}>
            {dot}
          </span>
        }
        className={cn("collection-select", "collection-select--swatch", className)}
      />
    </SelectPrimitive.Trigger>
  ) : (
    <SelectTrigger
      id={id}
      size={size}
      className={cn(fitLabeled && "collection-select", className)}
      aria-label={accessibleName}
      disabled={disabled}
      onKeyDown={onTriggerKeyDown}
    >
      <SelectValue />
    </SelectTrigger>
  );

  // The ghost trigger shows the name already; a labeled field may have its label.
  const tooltip = swatch || (!ghost && labeledTooltip);

  return (
    <Select
      value={value}
      disabled={disabled}
      onOpenChange={setListOpen}
      onValueChange={(next) => {
        if (next === COLLECTION_SELECT_CREATE_VALUE) {
          create?.onSelect();
          return;
        }
        if (!next || next === value) return;
        onValueChange(next);
      }}
    >
      {tooltip ? (
        <Tooltip open={listOpen ? false : undefined}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{accessibleName}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <SelectContent className={menuClassName} onCloseAutoFocus={onCloseAutoFocus}>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id} textValue={item.name}>
            <span className="collection-select__option" style={rowColor(item.color)}>
              {dot}
              <span className="collection-select__name">{item.name}</span>
            </span>
          </SelectItem>
        ))}
        {create ? (
          <>
            {items.length > 0 ? <SelectSeparator className="collection-select__separator" /> : null}
            <SelectItem value={COLLECTION_SELECT_CREATE_VALUE}>{create.label}</SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
