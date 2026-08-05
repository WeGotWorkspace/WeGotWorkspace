/** Sidebar / UI virtual path for the user trash location. */
export const DRIVE_TRASH_UI_PATH = "Trash";

/** Virtual root for the Shared with me browse view (not a filesystem directory). */
export const SHARED_WITH_ME_UI_ROOT = "Shared with me";

const GROUPS_UI_ROOT = "Groups";
const MY_DRIVE_UI_ROOT = "My Drive";
/** Foreign personal drives opened from Shared with me (`/users/{other}/…`). */
const USERS_UI_ROOT = "Users";

/** Ensure folder UI paths use a known top-level prefix (relative paths default to My Drive). */
export function normalizeDriveFolderUiPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (!trimmed) return MY_DRIVE_UI_ROOT;
  if (
    trimmed === MY_DRIVE_UI_ROOT ||
    trimmed.startsWith(`${MY_DRIVE_UI_ROOT}/`) ||
    trimmed === GROUPS_UI_ROOT ||
    trimmed.startsWith(`${GROUPS_UI_ROOT}/`) ||
    trimmed === USERS_UI_ROOT ||
    trimmed.startsWith(`${USERS_UI_ROOT}/`) ||
    trimmed === DRIVE_TRASH_UI_PATH ||
    trimmed.startsWith(`${DRIVE_TRASH_UI_PATH}/`) ||
    trimmed === SHARED_WITH_ME_UI_ROOT ||
    trimmed.startsWith(`${SHARED_WITH_ME_UI_ROOT}/`)
  ) {
    return trimmed;
  }
  return `${MY_DRIVE_UI_ROOT}/${trimmed}`;
}

/** Hidden directory name under the user drive root (filtered from normal listings). */
export const DRIVE_TRASH_DIR_NAME = ".Trash";

export function driveUserTrashApiPath(username: string): string {
  return normalizeApiVirtualPath(`/users/${username}/${DRIVE_TRASH_DIR_NAME}`);
}

export function isDriveTrashApiPath(path: string, username: string): boolean {
  const normalized = normalizeApiVirtualPath(path);
  const trashRoot = driveUserTrashApiPath(username);
  const legacyTrashRoot = normalizeApiVirtualPath(`/users/${username}/Trash`);
  return (
    normalized === trashRoot ||
    normalized.startsWith(`${trashRoot}/`) ||
    normalized === legacyTrashRoot ||
    normalized.startsWith(`${legacyTrashRoot}/`)
  );
}

export function isDriveTrashFolderName(name: string): boolean {
  return name === DRIVE_TRASH_DIR_NAME || name === "Trash";
}

export function normalizeApiVirtualPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "");
}

/** Personal or group drive roots (`/users/{username}`, `/groups/{slug}`) — not share targets. */
export function isTopLevelDriveApiPath(path: string | undefined): boolean {
  if (!path?.trim()) return false;
  return /^\/(users|groups)\/[^/]+$/.test(normalizeApiVirtualPath(path));
}

export function uiPathFromApiPath(path: string, username: string): string {
  const normalized = normalizeApiVirtualPath(path);
  const userRoot = `/users/${username}`;
  if (normalized === "/groups") {
    return "Groups";
  }
  if (normalized.startsWith("/groups/")) {
    return normalized.replace(/^\/groups/, "Groups");
  }
  if (normalized === userRoot) {
    return "My Drive";
  }
  const trashRoot = driveUserTrashApiPath(username);
  const legacyTrashRoot = `${userRoot}/Trash`;
  if (normalized === trashRoot || normalized === legacyTrashRoot) {
    return DRIVE_TRASH_UI_PATH;
  }
  if (normalized.startsWith(`${trashRoot}/`)) {
    return `${DRIVE_TRASH_UI_PATH}${normalized.slice(trashRoot.length)}`;
  }
  if (normalized.startsWith(`${legacyTrashRoot}/`)) {
    return `${DRIVE_TRASH_UI_PATH}${normalized.slice(legacyTrashRoot.length)}`;
  }
  if (normalized.startsWith(`${userRoot}/`)) {
    return `My Drive${normalized.slice(userRoot.length)}`;
  }
  // Foreign personal paths (e.g. Shared with me → open another user's folder).
  if (normalized.startsWith("/users/")) {
    return `${USERS_UI_ROOT}${normalized.slice("/users".length)}`;
  }
  return "My Drive";
}

export function apiPathFromUiPath(path: string, username: string, groupRoots: Set<string>): string {
  const normalized = path.trim().replace(/\/+$/, "");
  const userRoot = `/users/${username}`;
  if (normalized === "My Drive") {
    return userRoot;
  }
  if (normalized === "Groups") {
    return "/groups";
  }
  if (normalized.startsWith("Groups/")) {
    const relative = normalized.slice("Groups/".length);
    return `/groups/${relative}`;
  }
  if (normalized === USERS_UI_ROOT || normalized.startsWith(`${USERS_UI_ROOT}/`)) {
    const relative =
      normalized === USERS_UI_ROOT ? "" : normalized.slice(`${USERS_UI_ROOT}/`.length);
    return relative ? `/users/${relative}` : "/users";
  }
  if (normalized.startsWith("My Drive/")) {
    const relative = normalized.slice("My Drive/".length);
    const [head] = relative.split("/");
    if (head && groupRoots.has(head)) {
      return `/groups/${relative}`;
    }
    return `${userRoot}/${relative}`;
  }
  if (normalized === DRIVE_TRASH_UI_PATH) {
    return driveUserTrashApiPath(username);
  }
  if (normalized.startsWith(`${DRIVE_TRASH_UI_PATH}/`)) {
    return `${driveUserTrashApiPath(username)}/${normalized.slice(`${DRIVE_TRASH_UI_PATH}/`.length)}`;
  }
  return userRoot;
}
