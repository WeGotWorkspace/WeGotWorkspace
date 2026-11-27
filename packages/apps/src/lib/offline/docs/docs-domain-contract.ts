import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { OfflineDomainOperations } from "@/lib/offline/core/types";
import { createDocsFileOperations } from "@/lib/offline/docs/docs-file-operations";
import { driveOfflineDomainStore } from "@/lib/offline/drive/drive-domain-contract";

/**
 * Docs keeps no file store of its own: a Docs folder or file is a Drive
 * `drive_entries` row, so Docs binds Drive's store, and Docs home lists the
 * same tree (#2063). Its own tables hold pins; the stars are a shared meta key.
 */
export const docsOfflineDomainStore = driveOfflineDomainStore;

/** Docs file operations: Drive's hybrid factory with the Docs hooks, not a second factory. */
export const docsDomainOperations: OfflineDomainOperations<DriveAPIOperations> =
  createDocsFileOperations;
