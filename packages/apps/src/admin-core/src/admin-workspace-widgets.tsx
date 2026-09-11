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
      size="sm"
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
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="admin-feature-row">
      <div className="min-w-0">
        <div className="admin-feature-row__title">{label}</div>
        {desc ? <div className="admin-feature-row__desc">{desc}</div> : null}
      </div>
      <BooleanSegmentedControl value={value} onChange={onChange} aria-label={`${label} enabled`} />
    </div>
  );
}
