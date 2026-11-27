import type { EntityTable } from "dexie";
import {
  registerOfflineDomainTables,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { DRIVE_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import {
  areaFromCrawledPath,
  fileExtension,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";
import { DRIVE_UPLOAD_STORES } from "@/lib/offline/drive/upload/drive-upload-schema";

export const DRIVE_DOMAIN = "drive";

/**
 * Cached directory entry (serialized WgwDriveDirectoryEntry).
 * `id` stays the path. `nodeId` is optional until the first JMAP crawl.
 */
export type OfflineDriveEntryRow = {
  /** Normalized API path (no leading slash). Primary key; not the FileNode id. */
  id: string;
  parentPath: string;
  type: "file" | "dir";
  modifiedAt: number;
  /** JSON payload mirroring listing entry fields. */
  data: string;
  /** JMAP FileNode id. Absent on rows written before the first crawl. */
  nodeId?: string;
  /**
   * Upload queue item id. Set only on upload placeholders, whose `id` is
   * `<folder>/\u0000upload:<item id>` so it never collides with a real name,
   * and on the row of a folder a folder upload creates or adds into (#1620).
   */
  uploadId?: string;
  /** Lower-case file extension (`""` when none). Absent on folders. Indexed for Docs views. */
  ext?: string;
  /**
   * Which part of the tree the row belongs to. Set by a complete tree pass and
   * the change applier; rows a first sync has written so far have none yet.
   */
  area?: DriveEntryArea;
  /** Tags of the item (#2402), copied out of `data` so the tag view can use an index. */
  tags?: string[];
};

/**
 * One node of a tree pass in progress, keyed by FileNode id (#2063). The
 * persisted walked set: a resume after an abort keeps every page fetched
 * before it. Dot-path nodes are staged too, so a folder moved out of `.notes`
 * during the walk still brings its children. Cleared when a pass ends or restarts.
 */
export type OfflineDriveTreeStagingRow = {
  nodeId: string;
  parentId: string | null;
  name: string;
  /** The virtual path `FileNode/get` returned. Stale under an ancestor renamed later. */
  path: string;
  /** `WgwDriveDirectoryEntry` JSON as the get built it. */
  data: string;
};

/**
 * Where a node's rows were before a tree pass started, keyed by FileNode id
 * (#2063). Written before page 1 and reused on resume: pages upsert into
 * `drive_entries` during the walk, so only this map still says where each
 * node's blob and pins sit. Cleared with the staging table.
 */
export type OfflineDriveTreePrepassRow = {
  nodeId: string;
  /** `drive_entries` ids (no leading `/`) the node held before the pass. */
  paths: string[];
};

/** Binary file body cached for offline open/download. */
export type OfflineDriveContentBlobRow = {
  id: string;
  size: number;
  mimeType: string;
  syncedAt: number;
  blob: Blob;
};

export type OfflineDriveAvailabilitySource = "auto" | "manual";

/** Tracks which file paths have offline content (auto or manual pin). */
export type OfflineDriveAvailabilityRow = {
  id: string;
  source: OfflineDriveAvailabilitySource;
  pinnedAt: number;
  lastSyncedAt: number | null;
  entryModifiedAt: number | null;
};

registerOfflineDomainTables({
  domain: DRIVE_DOMAIN,
  versions: [
    {
      version: DRIVE_OFFLINE_VERSION.entriesTables,
      stores: {
        drive_entries: "id, parentPath, type, modifiedAt",
      },
    },
    {
      version: DRIVE_OFFLINE_VERSION.contentTables,
      stores: {
        drive_content_blobs: "id, size, syncedAt",
      },
    },
    {
      version: DRIVE_OFFLINE_VERSION.availabilityTables,
      stores: {
        drive_availability: "id, source, pinnedAt, lastSyncedAt",
      },
    },
    {
      version: DRIVE_OFFLINE_VERSION.entryNodeId,
      stores: {
        drive_entries: "id, parentPath, type, modifiedAt, nodeId",
      },
    },
    {
      version: DRIVE_OFFLINE_VERSION.uploadQueue,
      stores: {
        drive_entries: "id, parentPath, type, modifiedAt, nodeId, uploadId",
        ...DRIVE_UPLOAD_STORES,
      },
    },
    {
      version: DRIVE_OFFLINE_VERSION.treeSync,
      stores: {
        drive_entries: "id, parentPath, type, modifiedAt, nodeId, uploadId, ext, area",
        drive_tree_staging: "nodeId",
        drive_tree_prepass: "nodeId",
      },
      upgrade: (tx) =>
        tx
          .table<OfflineDriveEntryRow, string>("drive_entries")
          .toCollection()
          .modify((row) => {
            row.area = areaFromCrawledPath(row.id);
            if (row.type === "file") row.ext = fileExtension(row.id.split("/").pop() ?? "");
          }),
    },
    {
      version: DRIVE_OFFLINE_VERSION.entryTags,
      stores: {
        drive_entries: "id, parentPath, type, modifiedAt, nodeId, uploadId, ext, area, *tags",
      },
      upgrade: (tx) =>
        tx
          .table<OfflineDriveEntryRow, string>("drive_entries")
          .toCollection()
          .modify((row) => {
            try {
              const tags = (JSON.parse(row.data) as { tags?: unknown }).tags;
              if (Array.isArray(tags) && tags.length > 0) {
                row.tags = tags.filter((tag): tag is string => typeof tag === "string");
              }
            } catch {
              // A row whose body is not JSON has no tags to index.
            }
          }),
    },
  ],
});

export function driveEntriesTable(db: WgwOfflineDatabase): EntityTable<OfflineDriveEntryRow, "id"> {
  return db.table<OfflineDriveEntryRow, string>("drive_entries") as EntityTable<
    OfflineDriveEntryRow,
    "id"
  >;
}

export function driveContentBlobsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveContentBlobRow, "id"> {
  return db.table<OfflineDriveContentBlobRow, string>("drive_content_blobs") as EntityTable<
    OfflineDriveContentBlobRow,
    "id"
  >;
}

export function driveAvailabilityTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveAvailabilityRow, "id"> {
  return db.table<OfflineDriveAvailabilityRow, string>("drive_availability") as EntityTable<
    OfflineDriveAvailabilityRow,
    "id"
  >;
}

export function driveTreeStagingTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveTreeStagingRow, "nodeId"> {
  return db.table<OfflineDriveTreeStagingRow, string>("drive_tree_staging") as EntityTable<
    OfflineDriveTreeStagingRow,
    "nodeId"
  >;
}

export function driveTreePrepassTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineDriveTreePrepassRow, "nodeId"> {
  return db.table<OfflineDriveTreePrepassRow, string>("drive_tree_prepass") as EntityTable<
    OfflineDriveTreePrepassRow,
    "nodeId"
  >;
}
