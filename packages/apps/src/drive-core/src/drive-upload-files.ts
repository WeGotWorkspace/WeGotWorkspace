import { buildDriveFolderBreadcrumbs } from "@/drive-core/src/drive-breadcrumbs";
import { formatBytesCompact, inferFileKindFromName } from "@/drive-core/src/drive-file-utils";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";

/** Id of an upload in the Uploads view (never a server path). */
export function driveUploadViewFileId(itemId: string): string {
  return `upload:${itemId}`;
}

/**
 * Rows of the Uploads view, oldest first: one per queued, uploading, or failed
 * file across folders. `parent` is the target folder's UI path and `location`
 * its readable name ("Personal / Reports"), when this device knows the folder.
 */
export function driveFilesFromUploadQueue(
  snapshot: Pick<DriveUploadQueueSnapshot, "items">,
  username: string,
  rootLabels?: Readonly<Record<string, string>>,
): DriveFile[] {
  return snapshot.items.map((item) => {
    const folder = item.folderPath ? uiPathFromApiPath(`/${item.folderPath}`, username) : "";
    const location = folder
      ? buildDriveFolderBreadcrumbs(folder, driveLabels, rootLabels)
          .map((crumb) => crumb.label)
          .join(" / ")
      : undefined;
    const size = formatBytesCompact(item.bytesTotal);
    return {
      id: driveUploadViewFileId(item.id),
      notebook: size,
      category: "File",
      date: new Date(item.createdAt).toLocaleDateString(),
      title: item.name,
      excerpt: "",
      body: [],
      tags: [],
      wordCount: 0,
      parent: folder,
      kind: inferFileKindFromName(item.name),
      size,
      ...(location ? { location } : {}),
      upload: {
        id: item.id,
        status: item.status,
        ...(item.error ? { reason: item.error.code } : {}),
      },
    };
  });
}
