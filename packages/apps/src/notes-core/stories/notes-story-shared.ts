import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";

const bootstrap = createNotesAppBootstrap();

/** No-op Notes API operations for Storybook workspaces (Branding + Apps variants). */
export const notesStoryOperations = {
  upsertNote: async (note: (typeof bootstrap.data.notes)[number]) => note,
  deleteNote: async () => {},
  archiveNote: async (id: string) => bootstrap.data.notes.find((note) => note.id === id)!,
  restoreNote: async (id: string) => bootstrap.data.notes.find((note) => note.id === id)!,
  createNotebook: async (name: string) => ({ id: name, name }),
  patchNotebook: async (id: string, patch: { name?: string; color?: string | null }) => ({
    id,
    name: patch.name ?? id,
    color: patch.color,
  }),
  renameNotebook: async () => {},
  deleteNotebook: async () => {},
};
