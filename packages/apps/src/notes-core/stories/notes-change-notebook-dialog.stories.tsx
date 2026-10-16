import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { NotesChangeNotebookDialog } from "@/notes-core/src/notes-change-notebook-dialog";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookSelectItem } from "@/notes-core/src/notes-notebook-select";
import "@/notes-core/src/notes-workspace.css";

const seedNotebooks: NotesNotebookSelectItem[] =
  createNotesAppBootstrap().data.notebookCollections ?? [];

function NotesChangeNotebookDialogHarness({
  onNotebookChange,
  onCreateNotebook,
}: {
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [current, setCurrent] = useState<NotesNotebookSelectItem>(
    seedNotebooks[2] ?? seedNotebooks[0] ?? { id: "Drafts", name: "Drafts" },
  );

  return (
    <NotesChangeNotebookDialog
      open={open}
      notebooks={seedNotebooks}
      value={current}
      labels={defaultNotesLabels}
      onClose={() => setOpen(false)}
      onNotebookChange={(notebook) => {
        setCurrent(notebook);
        onNotebookChange(notebook);
      }}
      onCreateNotebook={onCreateNotebook}
    />
  );
}

const meta: Meta<typeof NotesChangeNotebookDialogHarness> = {
  title: "Features/Notes/Components/NotesChangeNotebookDialog",
  component: NotesChangeNotebookDialogHarness,
  tags: ["autodocs"],
  args: {
    onNotebookChange: fn(),
    onCreateNotebook: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NotesChangeNotebookDialogHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    const trigger = await screen.findByRole("combobox", {
      name: "Drafts",
    });
    await expect(trigger).toHaveTextContent("Drafts");

    const confirm = screen.getByRole("button", { name: "Change" });
    await expect(confirm).toHaveTextContent("Change");
    await expect(confirm).toHaveAttribute("aria-label", "Change");
    await expect(confirm).toBeDisabled();

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
    await expect(screen.getByRole("option", { name: "Drafts" })).toHaveAttribute(
      "data-state",
      "checked",
    );

    await userEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    await expect(args.onCreateNotebook).toHaveBeenCalledOnce();
    await expect(args.onNotebookChange).not.toHaveBeenCalled();
    await expect(screen.getByRole("dialog")).toBeTruthy();

    await userEvent.click(screen.getByRole("combobox", { name: "Drafts" }));
    await userEvent.click(screen.getByRole("option", { name: "The Journal" }));
    await expect(args.onNotebookChange).not.toHaveBeenCalled();
    await expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    await expect(args.onNotebookChange).toHaveBeenCalledOnce();
  },
};

const onDeleteNotes = fn();

export const DeleteNotebookChoice: Story = {
  tags: ["vitest-ci"],
  render: (args) => (
    <NotesChangeNotebookDialog
      open
      notebooks={seedNotebooks}
      value={seedNotebooks[0] ?? { id: "journal", name: "The Journal" }}
      labels={defaultNotesLabels}
      title={defaultNotesLabels.deleteNotebookHasNotesTitle}
      description={defaultNotesLabels.deleteNotebookHasNotesDescription}
      confirmLabel={defaultNotesLabels.deleteNotebookMoveConfirm}
      requireChange={false}
      destructiveAction={{
        label: defaultNotesLabels.deleteNotebookDeleteNotesToo,
        onAction: onDeleteNotes,
      }}
      onClose={() => {}}
      onNotebookChange={args.onNotebookChange}
    />
  ),
  play: async ({ args }) => {
    onDeleteNotes.mockClear();
    await expect(
      screen.getByRole("dialog", { name: defaultNotesLabels.deleteNotebookHasNotesTitle }),
    ).toBeTruthy();
    const confirm = screen.getByRole("button", {
      name: defaultNotesLabels.deleteNotebookMoveToConfirm(seedNotebooks[0]?.name ?? ""),
    });
    await expect(confirm).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: defaultNotesLabels.deleteNotebookDeleteNotesToo }),
    );
    await expect(onDeleteNotes).toHaveBeenCalledOnce();
    await expect(args.onNotebookChange).not.toHaveBeenCalled();
  },
};
