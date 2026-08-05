import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { DriveShareAccess } from "@wgw-api-generated/drive-types";
import { IconButton } from "@/button/src/icon-button";
import {
  accessToUIPermission,
  isDialogEditableAccess,
  type ShareUIPermission,
} from "@/share-ui/share-access-map";
import { ShareInheritedLabel } from "@/share-ui/share-inherited-link";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import { SharePendingTag } from "@/share-ui/share-pending-tag";
import { shareLabels, formatSharePathLabel } from "@/share-ui/share-labels";
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
  onAccessChange,
  onRemove,
}: SharePrincipalRowProps) {
  const inherited = Boolean(inheritedFromPath);
  const uiPermission = accessToUIPermission(access);
  const canEdit =
    editable && !inherited && Boolean(onAccessChange) && isDialogEditableAccess(access);
  const showRemove = inherited || Boolean(onRemove);
  const canRemove = Boolean(onRemove) && !inherited && !removeDisabled;
  const inheritedRemoveHint = inheritedFromPath
    ? shareLabels.inheritedFrom(formatSharePathLabel(inheritedFromPath))
    : undefined;

  return (
    <div className="share-dialog__row">
      {mark}
      <div className="share-dialog__row-main">
        <div className="share-dialog__row-title-line">
          <div className="share-dialog__row-title-group">
            <p className="share-dialog__row-title">{title}</p>
            {inheritedFromPath ? <ShareInheritedLabel sharePath={inheritedFromPath} /> : null}
          </div>
          {pending ? <SharePendingTag /> : null}
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
      {showRemove ? (
        <IconButton
          label={shareLabels.removeGrant}
          icon={<Trash2 className="size-3.5" aria-hidden />}
          size="sm"
          variant="outline"
          disabled={!canRemove}
          title={inherited ? (editHint ?? inheritedRemoveHint) : undefined}
          onClick={canRemove ? onRemove : undefined}
        />
      ) : null}
    </div>
  );
}
