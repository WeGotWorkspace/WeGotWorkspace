import type { DriveShareAccess } from "@wgw-api-generated/drive-types";

/** Share dialog permission levels (prototype parity: view / suggest / edit). */
export type ShareUIPermission = "view" | "suggest" | "edit";

const UI_TO_API: Record<ShareUIPermission, DriveShareAccess> = {
  view: "view",
  suggest: "review",
  edit: "edit",
};

const API_TO_UI: Partial<Record<DriveShareAccess, ShareUIPermission>> = {
  view: "view",
  review: "suggest",
  edit: "edit",
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

export const SHARE_UI_PERMISSIONS: ShareUIPermission[] = ["view", "suggest", "edit"];
