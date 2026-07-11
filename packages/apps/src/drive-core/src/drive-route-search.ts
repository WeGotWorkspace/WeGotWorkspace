import type { ViewKey } from "@/drive-core/src/drive-models";
import { normalizeDriveFolderUiPath } from "@/drive-core/src/drive-path-utils";

export type DriveRouteSearch = {
  view?: string;
  path?: string;
};

export function parseDriveRouteSearch(search: Record<string, unknown>): DriveRouteSearch {
  return {
    view: typeof search.view === "string" ? search.view : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
  };
}

export function validateDriveRouteSearch(search: Record<string, unknown>): DriveRouteSearch {
  return parseDriveRouteSearch(search);
}

/** Map router search params to the drive workspace view. */
export function driveViewFromSearch(search: DriveRouteSearch): ViewKey {
  const viewType = search.view?.trim();
  if (viewType === "recent") return { type: "recent" };
  if (viewType === "starred") return { type: "starred" };
  if (viewType === "shared") return { type: "shared" };
  if (viewType === "access") {
    const path = search.path?.trim();
    return {
      type: "access",
      scopePath: path ? normalizeDriveFolderUiPath(path) : undefined,
    };
  }
  const path = search.path?.trim();
  if (path) return { type: "folder", path: normalizeDriveFolderUiPath(path) };
  return { type: "folder", path: "My Drive" };
}

/** Drive workspace URL for a view (`/drive?…`). */
export function driveHrefFromView(view: ViewKey): string {
  const search = driveSearchFromView(view);
  const params = new URLSearchParams();
  if (search.view) params.set("view", search.view);
  if (search.path) params.set("path", search.path);
  const qs = params.toString();
  return `/drive${qs ? `?${qs}` : ""}`;
}

/** Open the drive access manager in a new browser tab/window (user-gesture safe). */
export function openDriveAccessInNewWindow(scopePath?: string): Window | null {
  const view: ViewKey = scopePath ? { type: "access", scopePath } : { type: "access" };
  return window.open(driveHrefFromView(view), "_blank", "noopener,noreferrer");
}

/** Serialize a workspace view for the /drive URL search params. */
export function driveSearchFromView(view: ViewKey): DriveRouteSearch {
  if (view.type === "access") {
    if (view.scopePath && view.scopePath !== "My Drive") {
      return { view: "access", path: view.scopePath };
    }
    return { view: "access" };
  }
  if (view.type === "folder") {
    if (view.path === "My Drive") return {};
    return { view: "folder", path: view.path };
  }
  return { view: view.type };
}
