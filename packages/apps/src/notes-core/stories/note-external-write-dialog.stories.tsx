import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen } from "storybook/test";
import { NoteExternalWriteDialog } from "@/note-detail-view/src/note-external-write-dialog";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import "@/notes-core/src/notes-workspace.css";

/** The note body's "changed outside the app" prompt, as Notes shows it. */
const meta = {
  title: "Features/Notes/Components/External write dialog",
  component: NoteExternalWriteDialog,
  args: {
    open: true,
    noteTitle: "Shopping",
    labels: defaultNotesLabels,
    onKeepLocal: fn(),
    onUseOutside: fn(),
  },
} satisfies Meta<typeof NoteExternalWriteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async () => {
    await expect(
      await screen.findByRole("dialog", { name: "Changed outside the app" }),
    ).toBeVisible();
  },
};

/** After the outside version replaced the note, only "Use the outside version" stays. */
export const KeepLocalDisabled: Story = {
  args: { keepLocalDisabled: true },
};
