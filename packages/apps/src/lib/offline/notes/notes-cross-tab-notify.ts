import { notifyNotesBootstrapUpdated } from "@/lib/offline/notes-bootstrap-sync";
import type { NotesAPIOperations } from "@/notes-core/src/notes-types";

/**
 * Tell the other open tabs after an archive, restore, or delete. They share
 * the offline cache, but only re-read it when told: a tab that was offline
 * kept showing a note another tab had archived until it was reloaded.
 *
 * Metadata edits (title, tags) are left out on purpose: each keystroke save
 * would make every tab run a /changes sync.
 */
export function notifyOtherTabsOnStructuralChanges(
  username: string,
  operations: NotesAPIOperations,
): NotesAPIOperations {
  const notify = () => notifyNotesBootstrapUpdated(username);
  return {
    ...operations,
    archiveNote: async (...args) => {
      const saved = await operations.archiveNote(...args);
      notify();
      return saved;
    },
    restoreNote: async (...args) => {
      const saved = await operations.restoreNote(...args);
      notify();
      return saved;
    },
    deleteNote: async (...args) => {
      await operations.deleteNote(...args);
      notify();
    },
  };
}
