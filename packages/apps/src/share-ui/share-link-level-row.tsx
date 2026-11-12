import { useId } from "react";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { shareLabels } from "@/share-ui/share-labels";

/** What a public link to a folder lets visitors do (#1715). File links stay view-only. */
export type ShareLinkLevel = "view" | "edit";

const LEVEL_OPTIONS: readonly { value: ShareLinkLevel; label: string }[] = [
  { value: "view", label: shareLabels.publicLevelView },
  { value: "edit", label: shareLabels.publicLevelAddFiles },
];

/** A legacy `full` row is treated as `edit`: guests still only add files. */
export function shareLinkLevel(defaultAccess: string | undefined): ShareLinkLevel {
  return defaultAccess === "edit" || defaultAccess === "full" ? "edit" : "view";
}

type ShareLinkLevelRowProps = {
  value: ShareLinkLevel;
  onChange: (value: ShareLinkLevel) => void;
  disabled?: boolean;
};

export function ShareLinkLevelRow({ value, onChange, disabled = false }: ShareLinkLevelRowProps) {
  const id = useId();
  return (
    <FieldLabelRow layout="inline" label={shareLabels.publicLevelLabel} htmlFor={id}>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as ShareLinkLevel)}
      >
        <CollectionGhostSelectTrigger
          id={id}
          aria-label={shareLabels.publicLevelLabel}
          label={<SelectValue />}
          disabled={disabled}
        />
        <SelectContent align="end">
          {LEVEL_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
