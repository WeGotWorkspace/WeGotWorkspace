import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  defaultOwnerScopeLabels,
  PERSONAL_SCOPE_VALUE,
  type OwnerScopeFieldLabels,
  type OwnerScopeGroupOption,
} from "@/ui/owner-scope-labels";

import "./owner-scope-field.css";

export {
  defaultOwnerScopeLabels,
  groupSlugFromOwnerScopeValue,
  ownerScopeDisplayLabel,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
} from "@/ui/owner-scope-labels";
export type { OwnerScopeFieldLabels, OwnerScopeGroupOption } from "@/ui/owner-scope-labels";

export type OwnerScopeFieldProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  groups: readonly OwnerScopeGroupOption[];
  personalOwnerLabel: string;
  labels?: OwnerScopeFieldLabels;
  disabled?: boolean;
};

export function OwnerScopeField({
  id,
  value,
  onValueChange,
  groups,
  personalOwnerLabel,
  labels: labelsProp,
  disabled = false,
}: OwnerScopeFieldProps) {
  const labels = labelsProp ?? defaultOwnerScopeLabels;

  return (
    <FieldLabelRow label={labels.label} htmlFor={id}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="owner-scope-field__trigger" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL_SCOPE_VALUE}>
            {labels.personal(personalOwnerLabel)}
          </SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.slug} value={group.slug}>
              {labels.group(group.displayName)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
