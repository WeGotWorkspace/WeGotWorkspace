import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import type { NotesAPIOperations } from "@/notes-core/src/notes-types";
import { createHybridNotesOperations } from "@/lib/offline/notes-hybrid-operations";
import {
  readNotesBootstrapFromCache,
  readSyncToken,
  removeNoteFromCache,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/notes-offline-store";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";

/**
 * Notes persistence wired to {@link OfflineDomainStore}. Domain-specific helpers
 * (outbox coalescing, notebook tokens, etc.) stay on `notes-offline-store.ts`.
 */
export const notesOfflineDomainStore = {
  readBootstrap: readNotesBootstrapFromCache,
  // The generic contract has no snapshot time: treat the bootstrap as taken now.
  writeBootstrap: (username, bootstrap) =>
    writeNotesBootstrapToCache(username, bootstrap, Date.now()),
  upsertEntity: upsertNoteInCache,
  removeEntity: removeNoteFromCache,
  readSyncToken,
  writeSyncToken,
} satisfies OfflineDomainStore<NotesAppBootstrap, Note>;

/** Notes hybrid API factory wired to {@link OfflineDomainOperations}. */
export const notesHybridDomainOperations: OfflineDomainOperations<NotesAPIOperations> =
  createHybridNotesOperations;
