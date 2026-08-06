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
            id: "shared-note-1",
            category: "Note",
            date: "—",
            excerpt: "Shared from bob",
            body: ["Shared from bob"],
            notebook: "TeamPad",
            tags: [],
            wordCount: 3,
            scope: "personal",
            groupSlug: null,
            apiPath: "/users/bob/.notes/TeamPad/shared-note-1.md",
            sharedInbox: true,
            sharedBy: "bob",
          },
          {
            id: "group-note-1",
            category: "Note",
            date: "2026-08-01T12:00:00.000Z",
            excerpt: "Eng specs note",
            body: ["Eng specs note"],
            notebook: "Specs",
            tags: ["planning"],
            wordCount: 3,
            scope: "group",
            groupSlug: "eng",
          },
        ],
        sharedNotebooks: [
          {
            path: "/groups/eng/.notes/Specs",
            notebook: "Specs",
            owner: "eng",
            scope: "group",
            groupSlug: "eng",
          },
          {
            path: "/users/bob/.notes/TeamPad",
            notebook: "TeamPad",
            owner: "bob",
            scope: "personal",
            groupSlug: null,
            access: "edit",
          },
        ],
      },
    }),
    shareOperations: createMockDriveShareOperations(),
    initialView: "shared-with-me",
  },
};
