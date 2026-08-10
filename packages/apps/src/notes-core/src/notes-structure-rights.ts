import type { Note } from "@/lib/models/note";
import { isPersonalShareRecipient } from "@/notes-core/src/notes-note-utils";

/** Optional live-fetched structure rights (owners / group members). */
export type NotesStructureShareRights = {
  mayManageStructure?: boolean;
};

/**
 * Whether archive / permanent delete should be offered for a note.
 *
 * Notes personal shares are view|edit only — never structure-manage.
 * Owners and group notebook members keep archive/delete.
 *
 * - Personal share recipient → never
 * - Owned / group membership → allowed unless explicit rights deny
 * - `undefined`/`null` rights while loading → locked (never flash as allowed)
 * - Storybook / no share fetch with non-personal notes → allowed
 */
export function noteAllowsStructureManage(
  note: Pick<Note, "sharedInbox" | "sharedNotebookGrant" | "sharedBy" | "scope">,
  rights?: NotesStructureShareRights | null,
  loading = false,
): boolean {
  if (isPersonalShareRecipient(note)) {
    return false;
  }

  if (rights?.mayManageStructure !== undefined) return rights.mayManageStructure === true;
  if (loading) return false;
  return true;
}
