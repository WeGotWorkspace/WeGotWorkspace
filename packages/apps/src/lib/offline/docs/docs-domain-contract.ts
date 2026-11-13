import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { OfflineDomainOperations } from "@/lib/offline/core/types";
import { createHybridDocsDriveOperations } from "@/lib/offline/docs/docs-hybrid-operations";
import { driveOfflineDomainStore } from "@/lib/offline/drive/drive-domain-contract";

/**
 * Docs keeps no file store of its own: a Docs folder or file is a Drive
 * `drive_entries` row, so Docs binds Drive's store. Its own tables are view
 * caches on top (home listings by filter, stars, pins). What differs per app
 * is the operations factory. One shared file workspace for both is #2063.
 */
export const docsOfflineDomainStore = driveOfflineDomainStore;

/** Docs hybrid API factory wired to {@link OfflineDomainOperations}. */
export const docsHybridDomainOperations: OfflineDomainOperations<DriveAPIOperations> =
  createHybridDocsDriveOperations;
