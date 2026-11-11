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
  triggerVariant,
}: {
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  disabled?: boolean;
  triggerVariant?: "labeled" | "swatch" | "ghost";
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
        triggerVariant={triggerVariant}
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
  title: "Features/Notes/Components/NotesNotebookSelect",
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
    const trigger = canvas.getByRole("combobox", {
      name: "Drafts",
    });
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
    await expect(document.querySelector(".collection-select__separator")).toBeTruthy();
    await expect(document.querySelectorAll(".collection-color-dot").length).toBeGreaterThan(0);
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

/** Ghost: the notebook name in its colour, above the note title in the detail pane. */
export const Ghost: Story = {
  tags: ["vitest-ci"],
  args: { triggerVariant: "ghost" },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Drafts" });
    await expect(trigger).toHaveClass("notes-notebook-select--ghost");
    await expect(trigger.querySelector(".collection-ghost-select__chevron")).toBeTruthy();
    await expect(getComputedStyle(trigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "Published" }));
    await expect(args.onNotebookChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Published" }),
    );
    await expect(within(canvasElement).getByRole("combobox", { name: "Published" })).toBeTruthy();
  },
};

/** Ghost, locked (shared or view-only note): no chevron, not clickable. */
export const GhostDisabled: Story = {
  tags: ["vitest-ci"],
  args: { triggerVariant: "ghost", disabled: true, onCreateNotebook: undefined },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Drafts" });
    await expect(trigger).toBeDisabled();
    await expect(trigger.querySelector(".collection-ghost-select__chevron")).toBeNull();
  },
};
