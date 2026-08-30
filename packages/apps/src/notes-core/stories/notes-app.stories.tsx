import type { Meta, StoryObj } from "@storybook/react-vite";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";

const meta: Meta<typeof NotesWorkspace> = {
  title: "Apps/Notes",
  component: NotesWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof NotesWorkspace>;

const bootstrap = createNotesAppBootstrap();

const storyOperations = {
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

export const Default: Story = {
  args: {
    ...bootstrap,
    operations: storyOperations,
  },
};

export const WithSharedSections: Story = {
  args: {
    ...createNotesAppBootstrap({
      data: {
        ...bootstrap.data,
        notes: [
          ...bootstrap.data.notes,
          {
            id: "group-note-1",
            category: "Note",
            date: "2026-08-01T12:00:00.000Z",
            excerpt: "Eng specs note",
            body: ["Eng specs note"],
            notebook: "Specs",
            notebookId: "group-eng",
            tags: ["planning"],
            wordCount: 3,
            scope: "group",
            groupSlug: "eng",
          },
        ],
        notebookCollections: [
          ...(bootstrap.data.notebookCollections ?? []).map((notebook) => ({
            ...notebook,
            isSharee: false,
            scope: "personal" as const,
          })),
          {
            id: "group-eng",
            name: "Specs",
            color: "#ec4899",
            isSharee: true,
            scope: "group",
            groupSlug: "eng",
          },
        ],
      },
    }),
    operations: storyOperations,
    initialView: "nb:group-eng",
  },
};
