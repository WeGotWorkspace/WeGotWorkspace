import type { Meta, StoryObj } from "@storybook/react-vite";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
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

export const Default: Story = {
  args: {
    ...bootstrap,
    shareOperations: createMockDriveShareOperations(),
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
          ...(bootstrap.data.notebooks ?? []).map((name) => ({
            id: name,
            name,
            isSharee: false,
            scope: "personal" as const,
          })),
          {
            id: "group-eng",
            name: "Specs",
            isSharee: true,
            scope: "group",
            groupSlug: "eng",
          },
        ],
      },
    }),
    initialView: "nb:group-eng",
  },
};
