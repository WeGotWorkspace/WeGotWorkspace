/**
 * Docs home rows from the local file tree (#2063 C4): Drive's mapping of tree
 * entries to rows, with Docs drive labels and newest first.
 */
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveFile } from "@/lib/files/drive-models";
import type { FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import { driveFilesFromTreeEntries } from "@/drive-core/src/drive-view-rows";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { resolveDocsDriveLabel, type DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";

export type DocsRowLabelOptions = {
  personalDriveLabel: string;
  groupRoots?: readonly DocsHomeGroupRoot[];
};

/** Inbound Shared-with-me location strings from Drive (kept as they are). */
function isInboundSharedDriveLocation(location: string): boolean {
  if (location === driveLabels.sidebarSharedWithMe) return true;
  return location.startsWith(driveLabels.sharedBy(""));
}

/**
 * A row's location in Docs words: Personal or the team drive's name instead of
 * Drive's "My Drive" or the slug; shared rows keep Drive's "Shared by …".
 */
export function docsRowLocation(
  driveLocation: string,
  sourceKey: string,
  options: DocsRowLabelOptions,
): string {
  if (isInboundSharedDriveLocation(driveLocation)) return driveLocation;
  return resolveDocsDriveLabel(sourceKey, options);
}

/** Docs home rows of a tree view, newest first (Recent comes that way). */
export function docsFilesFromTreeEntries(
  entries: readonly WgwDriveDirectoryEntry[],
  tree: FileTreeView,
  username: string,
  options: DocsRowLabelOptions,
): DriveFile[] {
  const files = driveFilesFromTreeEntries(entries, tree, username, {}).map((file) => {
    const sourceKey = (file.apiPath ?? "").replace(/^\/+/, "");
    return file.location && sourceKey
      ? { ...file, location: docsRowLocation(file.location, sourceKey, options) }
      : file;
  });
  if (tree.kind === "recent") return files;
  return files.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
}
