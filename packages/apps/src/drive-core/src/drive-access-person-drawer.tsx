import { Badge } from "@/ui/badge";
import { SideDrawer } from "@/ui/side-drawer";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { driveAccessViaUiPath } from "@/drive-core/src/drive-access-utils";
import { DriveAccessPermPill } from "@/drive-core/src/drive-access-perm-pill";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";

type DriveAccessPersonDrawerProps = {
  controller: DriveAccessController;
};

export function DriveAccessPersonDrawer({ controller }: DriveAccessPersonDrawerProps) {
  const {
    labels,
    username,
    personPrincipal,
    personData,
    personLoading,
    closePerson,
    navigateScopeFromVia,
  } = controller;

  const open = personPrincipal != null;
  const displayName = personData?.principal ?? personPrincipal ?? "";

  return (
    <SideDrawer
      open={open}
      onClose={closePerson}
      title={`${labels.accessPersonDrawerTitle} ${displayName}`}
      className="drive-access-person-drawer"
    >
      <div className="drive-access-person-drawer__header">
        <UserAvatar displayName={displayName} size="lg" />
        <div>
          <h3 className="drive-access-person-drawer__title">{displayName}</h3>
          {personData?.queriedPrincipalType ? (
            <p className="drive-access-person-drawer__subtitle">
              {personData.queriedPrincipalType}
            </p>
          ) : null}
        </div>
      </div>

      {personLoading ? (
        <p className="drive-access-person-drawer__loading">{labels.accessLoading}</p>
      ) : null}

      {!personLoading && personData?.entries.length === 0 ? (
        <p className="drive-access-person-drawer__empty">{labels.accessNoGrants}</p>
      ) : null}

      {!personLoading && personData?.entries.length ? (
        <ul className="drive-access-person-drawer__list">
          {personData.entries.map((entry, index) => {
            const viaPath = driveAccessViaUiPath(entry.source.sharePath, username);
            return (
              <li
                key={`${entry.source.shareId}-${index}`}
                className="drive-access-person-drawer__entry"
              >
                <div className="drive-access-person-drawer__entry-top">
                  <DriveAccessPermPill access={entry.access} />
                  {entry.relationship ? (
                    <Badge variant="outline" className="drive-access-person-drawer__relationship">
                      {entry.relationship}
                    </Badge>
                  ) : null}
                  {entry.status === "pending" ? (
                    <Badge variant="outline">{labels.accessPendingBadge}</Badge>
                  ) : null}
                </div>
                <p className="drive-access-person-drawer__via">
                  {labels.accessVia}{" "}
                  <button
                    type="button"
                    className="drive-access-person-drawer__via-link"
                    onClick={() => navigateScopeFromVia(entry.source.sharePath)}
                  >
                    {viaPath}
                  </button>
                </p>
                {entry.viaGroup ? (
                  <p className="drive-access-person-drawer__group">
                    Group: {entry.viaGroup.replace(/^groups\//, "")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </SideDrawer>
  );
}
