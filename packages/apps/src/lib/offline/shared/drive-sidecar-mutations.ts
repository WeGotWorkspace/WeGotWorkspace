import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import { parentAndName } from "@/lib/files/api-path";
import { migrateDocsAvailabilityPath } from "@/lib/offline/docs/docs-availability-store";
import { migrateDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import { migrateDriveContentBlobPath } from "@/lib/offline/drive/drive-content-sync";
import { migrateDriveEntryPath } from "@/lib/offline/drive/drive-directory-offline-store";

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

export function nextPathAfterRename(from: string, destination: string, to: string): string {
  const normalizedDest = normalizeApiVirtualPath(destination);
  return normalizedDest === "/" ? `/${to}` : `${normalizedDest}/${to}`;
}

/** Migrate local drive caches after a rename/move (entries, blobs, availability). */
export async function applyDriveSidecarPathMigration(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  const oldPath = normalizePath(from);
  const newPath = normalizePath(nextPathAfterRename(from, destination, to));

  await migrateDocsAvailabilityPath(username, oldPath, newPath);
  await migrateDriveAvailabilityPath(username, oldPath, newPath);
  await migrateDriveEntryPath(username, oldPath, newPath);
  await migrateDriveContentBlobPath(username, oldPath, newPath);
}

export { parentAndName };
