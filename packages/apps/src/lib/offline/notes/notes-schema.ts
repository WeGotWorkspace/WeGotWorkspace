import type { EntityTable, Transaction } from "dexie";
import {
  registerOfflineDomainTables,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { NOTES_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";

export type OfflineNotebookRow = {
  id: string;
  data: string;
};

export type OfflineNoteRow = {
  id: string;
  notebookId: string;
  data: string;
  pendingSync: boolean;
  /** Last local write time (epoch ms). Indexed at schema v11 for recency queries. */
  updatedAt: number;
};

export const NOTES_DOMAIN = "notes";

/**
 * Notes Dexie tables, registered as additive versions on top of the core
 * `{ meta, outbox }` baseline (v1):
 *
 * - **v10** introduces `notes_notebooks` and `notes_notes`.
 * - **v11** adds an additive `updatedAt` index on `notes_notes` and backfills
 *   the field for existing rows.
 */
registerOfflineDomainTables({
  domain: NOTES_DOMAIN,
  versions: [
    {
      version: NOTES_OFFLINE_VERSION.tables,
      stores: {
        notes_notebooks: "id",
        notes_notes: "id, notebookId, pendingSync",
      },
    },
    {
      version: NOTES_OFFLINE_VERSION.updatedAtIndex,
      stores: {
        notes_notes: "id, notebookId, pendingSync, updatedAt",
      },
      upgrade: async (tx: Transaction) => {
        const now = Date.now();
        await tx
          .table<OfflineNoteRow>("notes_notes")
          .toCollection()
          .modify((row) => {
            if (typeof row.updatedAt !== "number") {
              row.updatedAt = now;
            }
          });
      },
    },
  ],
});

export function notesNotesTable(db: WgwOfflineDatabase): EntityTable<OfflineNoteRow, "id"> {
  return db.table<OfflineNoteRow, string>("notes_notes") as EntityTable<OfflineNoteRow, "id">;
}

export function notesNotebooksTable(db: WgwOfflineDatabase): EntityTable<OfflineNotebookRow, "id"> {
  return db.table<OfflineNotebookRow, string>("notes_notebooks") as EntityTable<
    OfflineNotebookRow,
    "id"
  >;
}
