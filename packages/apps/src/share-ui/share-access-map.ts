import type { DriveShareAccess } from "@wgw/openapi-types/drive-types";

/** Share dialog permission levels for team and guest grants. */
export type ShareUIPermission = "view" | "comment" | "edit" | "full";

const UI_TO_API: Record<ShareUIPermission, DriveShareAccess> = {
  view: "view",
  comment: "comment",
  edit: "edit",
  full: "full",
};

/**
 * Maps API access to a dialog option.
 * Legacy `review` ("Can suggest") is folded into `edit`.
 */
const API_TO_UI: Partial<Record<DriveShareAccess, ShareUIPermission>> = {
  view: "view",
  comment: "comment",
  review: "edit",
  edit: "edit",
  full: "full",
};

export function uiPermissionToAccess(permission: ShareUIPermission): DriveShareAccess {
  return UI_TO_API[permission];
}

export function accessToUIPermission(access: DriveShareAccess): ShareUIPermission | null {
  return API_TO_UI[access] ?? null;
}

export function isDialogEditableAccess(access: DriveShareAccess): boolean {
  return accessToUIPermission(access) !== null;
}

export const SHARE_UI_PERMISSIONS: ShareUIPermission[] = ["view", "comment", "edit", "full"];

/**
 * Levels a new guest email invite may grant. A guest cannot comment, edit or
 * upload yet (threads and writes need a signed-in account), so only view is
 * offered until guest uploads land (#1715).
 */
export const GUEST_INVITE_UI_PERMISSIONS: readonly ShareUIPermission[] = ["view"];

/**
 * Options for an existing guest grant: the invite levels plus every level at or
 * below the grant's own. An older edit or full grant keeps showing its level
 * and can be lowered, but nothing can be raised above the invite levels.
 */
export function guestGrantUIPermissions(current: ShareUIPermission): ShareUIPermission[] {
  const currentRank = SHARE_UI_PERMISSIONS.indexOf(current);
  return SHARE_UI_PERMISSIONS.filter(
    (permission, rank) => rank <= currentRank || GUEST_INVITE_UI_PERMISSIONS.includes(permission),
  );
}

/** Notes team ACL is view / edit only (no comment, no full). */
export const NOTES_SHARE_UI_PERMISSIONS: ShareUIPermission[] = ["view", "edit"];

/**
 * Map API access onto a selectable dialog option for the given permission list.
 * Legacy Notes `full` grants fold to `edit` so they stay editable without offering Full.
 */
export function accessToSelectableUIPermission(
  access: DriveShareAccess,
  permissions: readonly ShareUIPermission[],
): ShareUIPermission | null {
  const mapped = accessToUIPermission(access);
  if (mapped === null) return null;
  if (permissions.includes(mapped)) return mapped;
  if (mapped === "full" && permissions.includes("edit")) return "edit";
  return null;
}
