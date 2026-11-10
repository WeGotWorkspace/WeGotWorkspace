import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import type { Note } from "@/lib/models/note";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";
import {
  NotesImportDialog,
  type NotesImportDialogProps,
} from "@/notes-core/src/notes-import-dialog";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesMarkdownImportResult } from "@/notes-core/src/notes-markdown-import-run";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { NotesStoryScope } from "./notes-story-scope";

const L = defaultNotesLabels;

const notebooks: NotesNotebookCollection[] = [
  { id: "general", name: "General", isDefault: true, color: "#2f6f4f" },
  { id: "work", name: "Work", color: "#1e3a5f" },
  { id: "recipes", name: "Recipes", color: "#b45309" },
];

const files = [
  new File(["---\ntitle: Trip to Lisbon\n---\n"], "lisbon.md"),
  new File(["# Shopping list"], "shopping.md"),
  new File(["Plain text"], "ideas.txt"),
];

const result: NotesMarkdownImportResult = {
  imported: [{ id: "n1" }, { id: "n2" }] as Note[],
  skipped: [
    { fileName: "scan.md", reason: "notUtf8" },
    { fileName: "huge-export.md", reason: "bodyTooLarge" },
    { fileName: "empty.md", reason: "empty" },
  ],
  droppedTags: ["2024", "to do"],
  imagesNotImported: 3,
};

function NotesImportDialogHarness(props: Partial<NotesImportDialogProps>) {
  const [open, setOpen] = useState(true);
  return (
    <NotesStoryScope>
      <NotesImportDialog
        open={open}
        files={files}
        notebooks={notebooks}
        defaultNotebookId="work"
        labels={L}
        onClose={() => setOpen(false)}
        onImport={fn()}
        {...props}
      />
    </NotesStoryScope>
  );
}

const meta: Meta<typeof NotesImportDialogHarness> = {
  title: "Features/Notes/Components/NotesImportDialog",
  component: NotesImportDialogHarness,
  args: { onImport: fn() },
};

export default meta;
type Story = StoryObj<typeof NotesImportDialogHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(await screen.findByText(L.importFilesSelected(3))).toBeInTheDocument();
    await expect(
      screen.getByRole("combobox", { name: L.importDestinationLegend }),
    ).toHaveTextContent("Work");
    await userEvent.click(screen.getByRole("button", { name: L.importSubmit }));
    await expect(args.onImport).toHaveBeenCalledWith(files, {
      mode: "existing",
      notebook: notebooks[1],
    });
  },
};

export const NewNotebook: Story = {
  tags: ["vitest-ci"],
  args: { notebooks: [] },
  play: async () => {
    const name = await screen.findByLabelText(L.importNewNotebookName);
    await expect(name).toHaveValue(L.importNewNotebookDefault);
    await expect(
      screen.getByRole("combobox", { name: L.importDestinationLegend }),
    ).toHaveTextContent(L.addNotebook);
  },
};

export const Importing: Story = {
  args: { busy: true, progress: { done: 1, total: 3 } },
};

export const Result: Story = {
  tags: ["vitest-ci"],
  args: { result },
  play: async () => {
    await expect(await screen.findByText(L.importedNotes(2))).toBeInTheDocument();
    await expect(screen.getByText(L.importSkippedHeading(3))).toBeInTheDocument();
    await expect(screen.getByText(L.importSkipReason("bodyTooLarge"))).toBeInTheDocument();
    await expect(screen.getByText(L.importImagesNotImported(3))).toBeInTheDocument();
  },
};

/** Nothing imported: the summary warns instead of showing a check. */
export const ResultNothingImported: Story = {
  args: {
    result: {
      imported: [],
      skipped: [
        { fileName: "meeting-notes.md", reason: "failed", status: 403 },
        { fileName: "a-very-long-file-name-exported-from-another-app-2024.md", reason: "empty" },
      ],
      droppedTags: [],
      imagesNotImported: 0,
    },
  },
};

export const DefaultDark: Story = {
  decorators: [withDarkTheme],
};

export const ResultDark: Story = {
  args: { result },
  decorators: [withDarkTheme],
};
