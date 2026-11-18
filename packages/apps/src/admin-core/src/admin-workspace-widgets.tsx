import { useId, type ReactNode } from "react";
import { IconButton } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Switch } from "@/ui/switch";

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

/** A switch row: caption and description start, switch end (suite inline row). */
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
  /** Optional chip right after the caption (for example a washed warning Tag). */
  labelAccessory?: ReactNode;
}) {
  const id = useId();
  return (
    <FieldLabelRow
      layout="inline"
      label={label}
      labelAccessory={labelAccessory}
      description={desc}
      htmlFor={id}
    >
      <Switch id={id} checked={value} onCheckedChange={onChange} disabled={disabled} />
    </FieldLabelRow>
  );
}
