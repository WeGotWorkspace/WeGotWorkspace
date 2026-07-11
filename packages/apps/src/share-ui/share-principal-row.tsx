import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { DriveShareAccess } from "@wgw-api-generated/drive-types";
import { IconButton } from "@/button/src/icon-button";
import {
  accessToUIPermission,
  isDialogEditableAccess,
  type ShareUIPermission,
} from "@/share-ui/share-access-map";
import { ShareInheritedLink } from "@/share-ui/share-inherited-link";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import { shareLabels } from "@/share-ui/share-labels";
import { accessLabelForReadOnly } from "@/share-ui/use-share-mutations";

type SharePrincipalRowProps = {
  mark: ReactNode;
  title: string;
  subtitle?: string;
  inheritedFromPath?: string;
  pending?: boolean;
  access: DriveShareAccess;
  editable?: boolean;
  editHint?: string;
  removeDisabled?: boolean;
  onOpenAccess?: (path: string) => void;
  onAccessChange?: (permission: ShareUIPermission) => void;
  onRemove?: () => void;
};

export function SharePrincipalRow({
  mark,
  title,
  subtitle,
  inheritedFromPath,
  pending = false,
  access,
  editable = true,
  editHint,
  removeDisabled = false,
  onOpenAccess,
  onAccessChange,
  onRemove,
}: SharePrincipalRowProps) {
  const inherited = Boolean(inheritedFromPath);
  const uiPermission = accessToUIPermission(access);
  const canEdit =
    editable && !inherited && Boolean(onAccessChange) && isDialogEditableAccess(access);

  return (
    <div className="share-dialog__row">
      {mark}
      <div className="share-dialog__row-main">
        <div className="share-dialog__row-title-line">
          <p className="share-dialog__row-title">{title}</p>
          {pending ? (
            <span className="share-dialog__pending-badge">{shareLabels.pendingGuest}</span>
          ) : null}
          {inheritedFromPath ? (
            <ShareInheritedLink sharePath={inheritedFromPath} onOpenAccess={onOpenAccess} />
          ) : null}
        </div>
        {subtitle ? <p className="share-dialog__row-subtitle">{subtitle}</p> : null}
      </div>
      {canEdit && uiPermission ? (
        <SharePermissionSelect
          value={uiPermission}
          title={editHint}
          onChange={(next) => {
            if (next !== "none") onAccessChange?.(next);
          }}
        />
      ) : uiPermission ? (
        <SharePermissionSelect value={uiPermission} disabled title={editHint} onChange={() => {}} />
      ) : (
        <span className="share-dialog__read-only-access" title={editHint}>
          {accessLabelForReadOnly(access)}
        </span>
      )}
      {onRemove ? (
        <IconButton
          label={shareLabels.removeGrant}
          icon={<Trash2 className="size-3.5" aria-hidden />}
          size="sm"
          variant="ghost"
          disabled={removeDisabled}
          onClick={onRemove}
        />
      ) : null}
    </div>
  );
}
