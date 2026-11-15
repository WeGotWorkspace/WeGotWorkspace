import { ChevronDown, LayoutGrid, List as ListIcon } from "lucide-react";

import { Button } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";
import type { ControlSize } from "@/ui/control-size";

export type ViewMode = "grid" | "list";

export type ViewModeToggleProps = {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  gridLabel: string;
  listLabel: string;
  className?: string;
  /** Default `md` = 36px — matches action-bar SelectTrigger / IconButton. */
  size?: ControlSize;
  disabled?: boolean;
  /**
   * "segmented" (default): both modes side by side. "menu": the current mode's icon with a
   * chevron, opening a menu with both (Calendar, beside its period arrows).
   */
  variant?: "segmented" | "menu";
  /** "menu" only: the menu opened or closed. */
  onOpenChange?: (open: boolean) => void;
};

const VIEW_MODE_LABEL = "View mode";

export function ViewModeToggle({
  value,
  onChange,
  gridLabel,
  listLabel,
  className,
  size = "md",
  disabled = false,
  variant = "segmented",
  onOpenChange,
}: ViewModeToggleProps) {
  const options = [
    { value: "grid" as const, label: gridLabel, icon: <LayoutGrid className="size-4" /> },
    { value: "list" as const, label: listLabel, icon: <ListIcon className="size-4" /> },
  ];

  if (variant === "menu") {
    const current = options.find((option) => option.value === value) ?? options[0];
    return (
      <DropdownMenu
        disabled={disabled}
        onOpenChange={onOpenChange}
        trigger={
          <Button
            aria-label={`${VIEW_MODE_LABEL}: ${current.label}`}
            icon={current.icon}
            trailingIcon={<ChevronDown />}
            size={size}
            variant="outline"
            disabled={disabled}
            className={className}
          />
        }
        items={options.map((option) => ({
          id: option.value,
          label: option.label,
          icon: option.icon,
          checked: option.value === value,
          onClick: () => onChange(option.value),
        }))}
      />
    );
  }

  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      size={size}
      className={className}
      disabled={disabled}
      aria-label={VIEW_MODE_LABEL}
      options={options}
    />
  );
}
