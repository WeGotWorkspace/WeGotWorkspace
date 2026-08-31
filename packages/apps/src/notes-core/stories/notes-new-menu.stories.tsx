import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesNewMenu } from "@/notes-core/src/notes-new-menu";
import "@/styles.css";
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
      <div className="app-sidebar__scroll">
        <NotesNewMenu {...args} />
      </div>
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof NotesNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const workspace = canvasElement.querySelector(".notes-workspace") as HTMLElement | null;
    await expect(workspace).toBeTruthy();
    const main = canvas.getByRole("button", { name: defaultNotesLabels.newNote });
    const ink = document.createElement("span");
    ink.style.backgroundColor = "var(--color-ink)";
    const accent = document.createElement("span");
    accent.style.color = "var(--notes-accent)";
    workspace!.append(ink, accent);
    await expect(getComputedStyle(main).backgroundColor).toBe(
      getComputedStyle(ink).backgroundColor,
    );
    await expect(getComputedStyle(main).color).toBe(getComputedStyle(accent).color);
    ink.remove();
    accent.remove();

    await userEvent.click(main);
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
