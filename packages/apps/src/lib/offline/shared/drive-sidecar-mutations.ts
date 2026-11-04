import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import { moveDocsPageSetupOverride } from "@/lib/docs-page-setup";
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

/**
 * Migrate local drive caches after a rename/move (entries, blobs, availability, page setup).
 *
 * An outbox flush passes `movePageSetup: false`: the offline rename or trash already moved
 * the page setup when it was queued. Moving it again could carry a new document's page setup,
 * made at the old path in the meantime, onto the renamed or trashed path.
 */
export async function applyDriveSidecarPathMigration(
  username: string,
  from: string,
  destination: string,
  to: string,
  { movePageSetup = true }: { movePageSetup?: boolean } = {},
): Promise<void> {
  const oldPath = normalizePath(from);
  const renamedPath = nextPathAfterRename(from, destination, to);
  const newPath = normalizePath(renamedPath);

  await migrateDocsAvailabilityPath(username, oldPath, newPath);
  await migrateDriveAvailabilityPath(username, oldPath, newPath);
  await migrateDriveEntryPath(username, oldPath, newPath);
  await migrateDriveContentBlobPath(username, oldPath, newPath);
  if (movePageSetup) moveDocsPageSetupOverride(from, renamedPath);
}

export { parentAndName };
