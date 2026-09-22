import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";

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

const brandingMeta = createBrandingStoryMeta({
  appId: "notes",
  workspaceClass: "notes-workspace",
  accentToken: "notes-accent",
  component: NotesWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Notes",
  tags: ["vitest-ci"],
} satisfies Meta<typeof NotesWorkspace>;

export default meta;
type Story = StoryObj<typeof NotesWorkspace>;

export const Default: Story = {
  args: {
    ...bootstrap,
    operations: storyOperations,
  },
};
