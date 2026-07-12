import { Users2 } from "lucide-react";
import type { DriveSharePrincipalEntry } from "@wgw-api-generated/drive-types";
import { initialsFromDisplayName } from "@/user-avatar/src/user-avatar";

type SharePrincipalMarkProps = {
  principalType: DriveSharePrincipalEntry["principalType"];
  displayName: string;
  active?: boolean;
};

export function SharePrincipalMark({
  principalType,
  displayName,
  active = false,
}: SharePrincipalMarkProps) {
  const stateClass = active ? "share-dialog__group-mark--active" : "share-dialog__group-mark--idle";

  if (principalType === "group") {
    return (
      <div className={`share-dialog__group-mark ${stateClass}`}>
        <Users2 className="size-3.5" aria-hidden />
      </div>
    );
  }

  const memberStateClass = active
    ? "share-dialog__member-mark--active"
    : "share-dialog__member-mark--idle";

  return (
    <div className={`share-dialog__member-mark ${memberStateClass}`}>
      {initialsFromDisplayName(displayName)}
    </div>
  );
}
