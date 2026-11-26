import { FieldLabelRow } from "@/ui/field-label-row";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { teamsOfferedAsOwner, viewerIsAdminOfNoTeam } from "@/lib/sharing/team-owner-options";
import {
  defaultOwnerScopeLabels,
  groupSlugFromOwnerScopeValue,
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
  // Only a team admin may add to a Team; the Team the collection is in stays listed.
  const offered = teamsOfferedAsOwner(groups, groupSlugFromOwnerScopeValue(value));
  const hint =
    !disabled && viewerIsAdminOfNoTeam(groups)
      ? (labels.noTeamAdminHint ?? defaultOwnerScopeLabels.noTeamAdminHint)
      : undefined;

  return (
    <FieldLabelRow layout="inline" label={labels.label} htmlFor={id} description={hint}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <CollectionGhostSelectTrigger id={id} label={<SelectValue />} disabled={disabled} />
        <SelectContent align="end">
          <SelectItem value={PERSONAL_SCOPE_VALUE}>
            {labels.personal(personalOwnerLabel)}
          </SelectItem>
          {offered.map((group) => (
            <SelectItem key={group.slug} value={group.slug}>
              {labels.group(group.displayName)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
