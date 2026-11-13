import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveAPIOperations, DriveAppBootstrap } from "@/lib/files/drive-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  readDriveBootstrapFromCache,
  removeDriveEntry,
  upsertDriveEntry,
  writeDriveBootstrapToCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { createHybridDriveOperations } from "@/lib/offline/drive/drive-hybrid-operations";
import { readDriveSyncToken, writeDriveSyncToken } from "@/lib/offline/drive/drive-inbound-sync";

/**
 * The file store wired to {@link OfflineDomainStore}: Drive's bootstrap and its
 * `drive_entries` rows, keyed by API path. Docs reads the same rows (see
 * `docs-domain-contract.ts`), so both apps bind this one store (#2063).
 *
 * FileNode/changes keeps one token for the whole account, so the token scope
 * is not used: every scope reads and writes that one token.
 */
export const driveOfflineDomainStore = {
  readBootstrap: readDriveBootstrapFromCache,
  writeBootstrap: writeDriveBootstrapToCache,
  upsertEntity: upsertDriveEntry,
  removeEntity: removeDriveEntry,
  readSyncToken: (username, _scope) => readDriveSyncToken(username),
  writeSyncToken: (username, _scope, token) => writeDriveSyncToken(username, token),
} satisfies OfflineDomainStore<DriveAppBootstrap, WgwDriveDirectoryEntry>;

/** Drive hybrid API factory wired to {@link OfflineDomainOperations}. */
export const driveHybridDomainOperations: OfflineDomainOperations<DriveAPIOperations> = (
  username,
) => createHybridDriveOperations(username);
