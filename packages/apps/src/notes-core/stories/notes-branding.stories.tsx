import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { notesStoryOperations } from "@/notes-core/stories/notes-story-shared";

const bootstrap = createNotesAppBootstrap();

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
    operations: notesStoryOperations,
  },
};
