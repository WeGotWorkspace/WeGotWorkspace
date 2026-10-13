/**
 * Custom value an unsaved document or note body stores in its y-indexeddb
 * database. Kept out of `use-docs-collab-save.ts` so logout can read it
 * without pulling the collab hook into that chunk.
 */
export const PENDING_SERVER_SAVE_KEY = "pendingServerSave";
