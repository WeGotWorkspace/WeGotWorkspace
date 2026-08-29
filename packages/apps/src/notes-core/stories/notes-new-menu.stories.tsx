import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesNewMenu } from "@/notes-core/src/notes-new-menu";
import "@/notes-core/src/notes-workspace.css";

const meta: Meta<typeof NotesNewMenu> = {
  title: "Apps/Notes/Components/NotesNewMenu",
  component: NotesNewMenu,
  tags: ["autodocs"],
  args: {
    labels: defaultNotesLabels,
    onCreateNote: fn(),
    onCreateNotebook: fn(),
  },
  render: (args) => (
    <div className="notes-workspace max-w-xs p-6">
      <NotesNewMenu {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof NotesNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: defaultNotesLabels.newNote }));
    await expect(args.onCreateNote).toHaveBeenCalledOnce();

    await userEvent.click(canvas.getByRole("button", { name: defaultNotesLabels.newNoteMenu }));
    await userEvent.click(screen.getByRole("button", { name: defaultNotesLabels.addNotebook }));
    await expect(args.onCreateNotebook).toHaveBeenCalledOnce();
  },
};

export const NoteOnly: Story = {
  args: {
    onCreateNotebook: undefined,
  },
};
