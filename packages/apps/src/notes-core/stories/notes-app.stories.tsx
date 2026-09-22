import type { Meta, StoryObj } from "@storybook/react-vite";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { notesStoryOperations } from "@/notes-core/stories/notes-story-shared";

const meta: Meta<typeof NotesWorkspace> = {
  title: "Features/Notes",
  component: NotesWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof NotesWorkspace>;

const bootstrap = createNotesAppBootstrap();

/** Chrome Default lives under Branding/Notes — shared-notebook sidebar layout. */
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
    operations: notesStoryOperations,
    initialView: "nb:group-eng",
  },
};
