import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesRenameTagDialog } from "@/notes-core/src/notes-rename-tag-dialog";
import { NotesStoryScope } from "@/notes-core/stories/notes-story-scope";

const meta: Meta<typeof NotesRenameTagDialog> = {
  title: "Features/Notes/Components/NotesRenameTagDialog",
  component: NotesRenameTagDialog,
  args: {
    open: true,
    tag: "focus",
    existingTags: ["focus", "reading"],
    labels: defaultNotesLabels,
    onClose: fn(),
    onRename: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NotesRenameTagDialog>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: (args) => (
    <NotesStoryScope>
      <NotesRenameTagDialog {...args} />
    </NotesStoryScope>
  ),
  play: async () => {
    const input = await screen.findByRole("textbox", { name: "Tag name" });
    await expect(input).toHaveValue("focus");
    await expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    await expect(screen.queryByText(/already exists/)).toBeNull();
  },
};

export const InvalidName: Story = {
  tags: ["vitest-ci"],
  render: (args) => (
    <NotesStoryScope>
      <NotesRenameTagDialog {...args} />
    </NotesStoryScope>
  ),
  play: async () => {
    const input = await screen.findByRole("textbox", { name: "Tag name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Foo Bar");
    await expect(screen.getByText(defaultNotesLabels.tagCharsetHint)).toBeTruthy();
    await expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  },
};

export const MergeWarning: Story = {
  tags: ["vitest-ci"],
  render: (args) => (
    <NotesStoryScope>
      <NotesRenameTagDialog {...args} />
    </NotesStoryScope>
  ),
  play: async () => {
    const input = await screen.findByRole("textbox", { name: "Tag name" });
    await userEvent.clear(input);
    await userEvent.type(input, "reading");
    await expect(
      screen.getByText("“reading” already exists. The two tags will be merged."),
    ).toBeTruthy();
    await expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  },
};
