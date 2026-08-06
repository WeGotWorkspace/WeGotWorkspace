import type { Note } from "@/lib/models/note";
import { isPersonalShareRecipient } from "@/notes-core/src/notes-note-utils";

/** Subset of drive `myRights` for Notes archive / delete (structure manage). */
export type NotesStructureShareRights = {
  mayManageStructure?: boolean;
};

/**
 * Whether archive / permanent delete should be offered for a note.
 *
 * Notes personal shares are view|edit only — never structure-manage.
 * Owners and group notebook members keep archive/delete.
 *
 * - Personal share recipient → never (ignore stale full / mayManageStructure)
 * - Owned / group membership → allowed unless explicit rights deny
 * - `undefined`/`null` rights while loading → locked (never flash as allowed)
 * - Storybook / no share fetch with non-personal notes → allowed
 */
export function noteAllowsStructureManage(
  note: Pick<Note, "sharedInbox" | "sharedNotebookGrant" | "sharedBy" | "scope" | "myRights">,
  rights?: NotesStructureShareRights | null,
  loading = false,
): boolean {
  if (isPersonalShareRecipient(note)) {
    return false;
  }

  const resolved = rights?.mayManageStructure ?? note.myRights?.mayManageStructure;
  if (resolved !== undefined) return resolved === true;
  if (loading) return false;
  return true;
}
