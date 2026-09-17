import { LayoutGrid, List as ListIcon } from "lucide-react";

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
};

export function ViewModeToggle({
  value,
  onChange,
  gridLabel,
  listLabel,
  className,
  size = "md",
  disabled = false,
}: ViewModeToggleProps) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      size={size}
      className={className}
      disabled={disabled}
      aria-label="View mode"
      options={[
        { value: "grid", label: gridLabel, icon: <LayoutGrid className="size-4" /> },
        { value: "list", label: listLabel, icon: <ListIcon className="size-4" /> },
      ]}
    />
  );
}
