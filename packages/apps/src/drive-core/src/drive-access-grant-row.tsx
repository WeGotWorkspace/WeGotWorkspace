import { Globe, Users } from "lucide-react";
import { Badge } from "@/ui/badge";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import type { DriveAccessDisplayRow } from "@/drive-core/src/drive-access-utils";
import {
  driveAccessIsPersonPrincipal,
  driveAccessPrincipalLabel,
  driveAccessViaUiPath,
} from "@/drive-core/src/drive-access-utils";
import { DriveAccessPermPill } from "@/drive-core/src/drive-access-perm-pill";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";

type DriveAccessGrantRowProps = {
  row: DriveAccessDisplayRow;
  controller: DriveAccessController;
};

function PrincipalAvatar({ row }: { row: DriveAccessDisplayRow }) {
  if (row.kind === "public") {
    return (
      <span
        className="drive-access-grant-row__avatar drive-access-grant-row__avatar--icon"
        aria-hidden
      >
        <Globe className="size-4" />
      </span>
    );
  }

  const { principal, principalType } = row.entry;
  const label = driveAccessPrincipalLabel(principal, principalType);

  if (principalType === "group") {
    return (
      <span
        className="drive-access-grant-row__avatar drive-access-grant-row__avatar--icon"
        aria-hidden
      >
        <Users className="size-4" />
      </span>
    );
  }

  return (
    <UserAvatar displayName={label} compact size="sm" className="drive-access-grant-row__avatar" />
  );
}

export function DriveAccessGrantRow({ row, controller }: DriveAccessGrantRowProps) {
  const { labels, username, openPerson, navigateScopeFromVia } = controller;

  if (row.kind === "public") {
    const viaPath = driveAccessViaUiPath(row.entry.sharePath, username);
    return (
      <div className="drive-access-grant-row">
        <PrincipalAvatar row={row} />
        <div className="drive-access-grant-row__main">
          <div className="drive-access-grant-row__title-row">
            <span className="drive-access-grant-row__name">{labels.accessPublicLink}</span>
            {row.entry.status === "expired" ? (
              <Badge variant="secondary" className="drive-access-grant-row__badge">
                {labels.accessExpiredBadge}
              </Badge>
            ) : null}
          </div>
          <div className="drive-access-grant-row__meta">
            <DriveAccessPermPill access={row.entry.defaultAccess} />
            <span className="drive-access-grant-row__via">
              {labels.accessVia}{" "}
              <button
                type="button"
                className="drive-access-grant-row__via-link"
                onClick={() => navigateScopeFromVia(row.entry.sharePath)}
              >
                {viaPath}
              </button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const { entry } = row;
  const label = driveAccessPrincipalLabel(entry.principal, entry.principalType);
  const viaPath = driveAccessViaUiPath(entry.source.sharePath, username);
  const isPerson = driveAccessIsPersonPrincipal(entry.principalType);

  return (
    <div className="drive-access-grant-row">
      <PrincipalAvatar row={row} />
      <div className="drive-access-grant-row__main">
        <div className="drive-access-grant-row__title-row">
          {isPerson ? (
            <button
              type="button"
              className="drive-access-grant-row__name drive-access-grant-row__name--button"
              onClick={() => openPerson(entry.principal)}
            >
              {label}
            </button>
          ) : (
            <span className="drive-access-grant-row__name">{label}</span>
          )}
          {entry.principalType === "email" ? (
            <Badge variant="secondary" className="drive-access-grant-row__badge">
              {labels.accessExternalBadge}
            </Badge>
          ) : null}
          {entry.status === "pending" ? (
            <Badge variant="outline" className="drive-access-grant-row__badge">
              {labels.accessPendingBadge}
            </Badge>
          ) : null}
          {entry.source.status === "expired" ? (
            <Badge variant="secondary" className="drive-access-grant-row__badge">
              {labels.accessExpiredBadge}
            </Badge>
          ) : null}
        </div>
        <div className="drive-access-grant-row__meta">
          <DriveAccessPermPill access={entry.access} />
          <span className="drive-access-grant-row__via">
            {labels.accessVia}{" "}
            <button
              type="button"
              className="drive-access-grant-row__via-link"
              onClick={() => navigateScopeFromVia(entry.source.sharePath)}
            >
              {viaPath}
            </button>
            {entry.source.inherited ? (
              <span className="drive-access-grant-row__inherited"> (inherited)</span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
