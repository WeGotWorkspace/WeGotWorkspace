import { FieldLabelRow } from "@/ui/field-label-row";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import {
  defaultOwnerScopeLabels,
  PERSONAL_SCOPE_VALUE,
  type OwnerScopeFieldLabels,
  type OwnerScopeGroupOption,
} from "@/ui/owner-scope-labels";

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
    <FieldLabelRow layout="inline" label={labels.label} htmlFor={id}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <CollectionGhostSelectTrigger id={id} label={<SelectValue />} disabled={disabled} />
        <SelectContent align="end">
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
