import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
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

/** Chrome Default lives under Themes/Notes — shared-notebook sidebar layout. */
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

/** Tag view: sidebar tags are plain chips; renaming lives in the list header (#1744). */
export const TagView: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    operations: notesStoryOperations,
    initialView: "tag:essay",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Edit tag" })).toBeInTheDocument();
    const tags = canvasElement.querySelector<HTMLElement>(".notes-sidebar-tags");
    await expect(tags).toBeTruthy();
    await expect(within(tags!).queryByRole("button", { name: /rename|edit/i })).toBeNull();
  },
};
