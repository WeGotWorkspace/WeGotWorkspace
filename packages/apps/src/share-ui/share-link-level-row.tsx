import { Eye, Upload, UserRound } from "lucide-react";
import { shareLabels } from "@/share-ui/share-labels";
import { ShareRowSelect, type ShareRowSelectOption } from "@/share-ui/share-row-select";

/** What a public link to a folder lets visitors do (#1715). File links stay view-only. */
export type ShareLinkLevel = "view" | "edit";

const LEVEL_OPTIONS: readonly ShareRowSelectOption<ShareLinkLevel>[] = [
  { value: "view", label: shareLabels.publicLevelView, icon: Eye },
  { value: "edit", label: shareLabels.publicLevelAddFiles, icon: Upload },
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
  return (
    <div className="share-dialog__password-row share-dialog__link-level-row">
      <UserRound className="share-dialog__password-icon" aria-hidden />
      <span className="share-dialog__password-label">{shareLabels.publicLevelLabel}</span>
      <ShareRowSelect
        value={value}
        options={LEVEL_OPTIONS}
        disabled={disabled}
        aria-label={shareLabels.publicLevelLabel}
        onChange={onChange}
      />
    </div>
  );
}
