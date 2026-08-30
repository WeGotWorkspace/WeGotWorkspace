import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  NotesNotebookSelect,
  type NotesNotebookSelectItem,
} from "@/notes-core/src/notes-notebook-select";
import "@/notes-core/src/notes-workspace.css";

const seedNotebooks: NotesNotebookSelectItem[] =
  createNotesAppBootstrap().data.notebookCollections ?? [];

function NotesNotebookSelectHarness({
  onNotebookChange,
  onCreateNotebook,
  disabled = false,
}: {
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState<NotesNotebookSelectItem>(
    seedNotebooks[2] ?? seedNotebooks[0] ?? { id: "Drafts", name: "Drafts" },
  );

  return (
    <div className="notes-workspace max-w-sm p-6">
      <NotesNotebookSelect
        notebooks={seedNotebooks}
        value={current}
        labels={defaultNotesLabels}
        disabled={disabled}
        onNotebookChange={(notebook) => {
          setCurrent(notebook);
          onNotebookChange(notebook);
        }}
        onCreateNotebook={onCreateNotebook}
      />
    </div>
  );
}

const meta: Meta<typeof NotesNotebookSelectHarness> = {
  title: "Apps/Notes/Components/NotesNotebookSelect",
  component: NotesNotebookSelectHarness,
  tags: ["autodocs"],
  args: {
    onNotebookChange: fn(),
    onCreateNotebook: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NotesNotebookSelectHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    await expect(trigger).toHaveTextContent("Drafts");

    await userEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    await expect(options.map((option) => option.textContent?.trim())).toEqual([
      "The Journal",
      "Field Observations",
      "Drafts",
      "Published",
      defaultNotesLabels.addNotebook,
    ]);
    await expect(document.querySelector(".notes-notebook-select__separator")).toBeTruthy();
    await expect(document.querySelectorAll(".notes-notebook-color-icon").length).toBeGreaterThan(0);
    await expect(document.querySelector(".collection-sidebar-row__dot")).toBeNull();
    await expect(screen.getByRole("option", { name: "Drafts" })).toHaveAttribute(
      "data-state",
      "checked",
    );

    await userEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    await expect(args.onCreateNotebook).toHaveBeenCalledOnce();
    await expect(args.onNotebookChange).not.toHaveBeenCalled();
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    onCreateNotebook: undefined,
  },
};
