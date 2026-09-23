import type { DriveShareAccess } from "@wgw/openapi-types/drive-types";
import {
  SHARE_UI_PERMISSIONS,
  accessToSelectableUIPermission,
  type ShareUIPermission,
} from "@/share-ui/share-access-map";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import { ShareInheritedLabel } from "@/share-ui/share-inherited-link";
import { SharePermissionSelect } from "@/share-ui/share-permission-select";
import { SharePendingTag } from "@/share-ui/share-pending-tag";
import { SharePrincipalMark, type SharePrincipalKind } from "@/share-ui/share-principal-mark";
import { shareLabels, formatSharePathLabel } from "@/share-ui/share-labels";
import { accessLabelForReadOnly } from "@/share-ui/use-share-mutations";

type SharePrincipalRowProps = {
  principalType: SharePrincipalKind;
  displayName: string;
  /** Stable identity key for per-user palette (user principals only). */
  principalId?: string;
  subtitle?: string;
  inheritedFromPath?: string;
  pending?: boolean;
  access: DriveShareAccess;
  editable?: boolean;
  editHint?: string;
  removeDisabled?: boolean;
  onAccessChange?: (permission: ShareUIPermission) => void;
  onRemove?: () => void;
  permissions?: readonly ShareUIPermission[];
};

export function SharePrincipalRow({
  principalType,
  displayName,
  principalId,
  subtitle,
  inheritedFromPath,
  pending = false,
  access,
  editable = true,
  editHint,
  removeDisabled = false,
  onAccessChange,
  onRemove,
  permissions = SHARE_UI_PERMISSIONS,
}: SharePrincipalRowProps) {
  const inherited = Boolean(inheritedFromPath);
  const uiPermission = accessToSelectableUIPermission(access, permissions);
  const canEdit = editable && !inherited && Boolean(onAccessChange) && uiPermission !== null;
  const showRemove = inherited || Boolean(onRemove);
  const canRemove = Boolean(onRemove) && !inherited && !removeDisabled;
  const inheritedRemoveHint = inheritedFromPath
    ? shareLabels.inheritedFrom(formatSharePathLabel(inheritedFromPath))
    : undefined;

  const trailing =
    permissions.length === 0 ? undefined : canEdit && uiPermission ? (
      <SharePermissionSelect
        value={uiPermission}
        title={editHint}
        permissions={permissions}
        onChange={(next) => {
          if (next !== "none") onAccessChange?.(next);
        }}
      />
    ) : uiPermission ? (
      <SharePermissionSelect
        value={uiPermission}
        disabled
        title={editHint}
        permissions={permissions}
        onChange={() => {}}
      />
    ) : (
      <span className="share-dialog__read-only-access" title={editHint}>
        {accessLabelForReadOnly(access)}
      </span>
    );

  return (
    <ShareAccessRow
      mark={
        <SharePrincipalMark
          principalType={principalType}
          displayName={displayName}
          principalId={principalId}
          subtitle={subtitle}
          size="sm"
          labeled
          nameAccessory={
            inheritedFromPath ? <ShareInheritedLabel sharePath={inheritedFromPath} /> : null
          }
          nameEnd={pending ? <SharePendingTag /> : null}
        />
      }
      trailing={trailing}
      showRemove={showRemove}
      removeDisabled={!canRemove}
      removeTitle={inherited ? (editHint ?? inheritedRemoveHint) : undefined}
      onRemove={canRemove ? onRemove : undefined}
    />
  );
}
