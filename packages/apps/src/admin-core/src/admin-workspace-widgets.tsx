import type { ReactNode } from "react";
import { IconButton } from "@/button/src/button";
import { BooleanSegmentedControl } from "@/segmented-control/src/segmented-control";

export function IconActionButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <IconButton
      label={label}
      icon={children}
      onClick={onClick}
      disabled={disabled}
      size="md"
      variant="outline"
      className="admin-icon-action"
    />
  );
}

export function FeatureRow({
  label,
  desc,
  value,
  onChange,
  disabled,
  labelAccessory,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Optional chip next to the title (for example a washed warning Tag). */
  labelAccessory?: ReactNode;
}) {
  return (
    <div className="admin-feature-row">
      <div className="min-w-0">
        <div className="admin-feature-row__title-row">
          <div className="admin-feature-row__title">{label}</div>
          {labelAccessory}
        </div>
        {desc ? <div className="admin-feature-row__desc">{desc}</div> : null}
      </div>
      <BooleanSegmentedControl
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={`${label} enabled`}
      />
    </div>
  );
}
