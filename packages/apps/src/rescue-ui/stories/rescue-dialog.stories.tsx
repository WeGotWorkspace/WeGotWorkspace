import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { RescueDialog } from "@/rescue-ui/rescue-dialog";
import { rescueNotice } from "@/rescue-ui/rescue-notice";
import {
  notebookRescueView,
  parkedNote,
  storyNotebooks,
  type StoryNote,
} from "@/rescue-ui/stories/rescue-dialog.fixtures";
import { NotesStoryScope } from "@/notes-core/stories/notes-story-scope";

/** Moving or discarding removes that notebook's notes, as an app does. */
function Interactive(props: { writes: ParkedWrite<StoryNote>[] }) {
  const [writes, setWrites] = useState(props.writes);
  const [open, setOpen] = useState(true);
  const drop = (ids: string[]) =>
    setWrites((all) => all.filter((write) => !ids.includes(write.id)));
  return (
    <>
      <NoticeBar
        label="Needs your attention"
        notices={[rescueNotice("notes", notebookRescueView, writes, () => setOpen(true))]}
      />
      <RescueDialog
        open={open && writes.length > 0}
        writes={writes}
        containers={storyNotebooks}
        view={notebookRescueView}
        onMove={drop}
        onDiscard={drop}
        onLater={() => setOpen(false)}
      />
    </>
  );
}

/**
 * The rescue dialog every app with containers shares (#1565). Tasks uses it for
 * lists (Features/Tasks/Panes/Rescue dialog); these stories give it a notebook
 * adapter to show the app's noun and icon in place of the list's.
 */
const meta: Meta<typeof Interactive> = {
  title: "Features/Rescue/Rescue dialog",
  component: Interactive,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <NotesStoryScope>
        <Story />
      </NotesStoryScope>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Interactive>;

/** Two notes added offline to a notebook that was deleted meanwhile. */
export const NotebookGone: Story = {
  args: {
    writes: [parkedNote("Pasta recipe", "Recipes"), parkedNote("Bread timings", "Recipes")],
  },
  play: async () => {
    const dialog = within(await screen.findByRole("dialog"));
    await expect(dialog.getByRole("heading", { name: "2 notes from “Recipes”" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name of the new notebook" })).toHaveValue(
      "Recipes",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Move to: New notebook" }));
    const journal = await screen.findByRole("menuitem", { name: "Journal" });
    await expect(journal.querySelector(".notes-notebook-color-dot")).not.toBeNull();
    await expect(screen.getByRole("menuitem", { name: "New notebook" })).toBeVisible();
    await userEvent.click(journal);

    await expect(dialog.queryByRole("textbox")).toBeNull();
    await expect(dialog.getByRole("button", { name: "Move 2 notes" })).toBeEnabled();
  },
};

/** A notebook that became view-only, with an edited note: the name gets "(copy)". */
export const NotebookViewOnlyWithEdits: Story = {
  args: {
    writes: [
      parkedNote("Q3 planning", "Team notes", "readOnly", "edit"),
      parkedNote("Retro actions", "Team notes", "readOnly"),
    ],
  },
  play: async () => {
    const dialog = within(await screen.findByRole("dialog"));
    await expect(dialog.getByText(/Edited notes are kept as new notes\./)).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name of the new notebook" })).toHaveValue(
      "Team notes (copy)",
    );
  },
};

/** Two notebooks: their dialogs follow each other. "Decide later" skips to the next. */
export const TwoNotebooks: Story = {
  args: {
    writes: [
      parkedNote("Pasta recipe", "Recipes"),
      parkedNote("Q3 planning", "Team notes", "readOnly", "edit"),
    ],
  },
  play: async () => {
    const dialog = within(await screen.findByRole("dialog"));
    await expect(dialog.getByText("Notebook 1 of 2")).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Decide later" }));
    await expect(await screen.findByText("Notebook 2 of 2")).toBeVisible();
    await expect(screen.getByRole("heading", { name: "A note from “Team notes”" })).toBeVisible();
  },
};

/** While a move is running. */
export const Busy: StoryObj<typeof RescueDialog<StoryNote, (typeof storyNotebooks)[number]>> = {
  render: () => (
    <RescueDialog
      open
      busy
      writes={[parkedNote("Pasta recipe", "Recipes")]}
      containers={storyNotebooks}
      view={notebookRescueView}
      onMove={() => undefined}
      onDiscard={() => undefined}
      onLater={() => undefined}
    />
  ),
};

/** The notice bar row that reopens the dialog after "Decide later" (#1894). */
export const Notice: StoryObj = {
  render: () => (
    <NoticeBar
      label="Needs your attention"
      notices={[
        rescueNotice(
          "notes",
          notebookRescueView,
          [parkedNote("Pasta recipe", "Recipes"), parkedNote("Stand-up", "Team notes")],
          () => undefined,
        ),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole("region", { name: "Needs your attention" });
    await expect(bar).toHaveTextContent("2 notes from 2 notebooks need a new notebook");
    await expect(within(bar).getByRole("button", { name: "Review" })).toBeVisible();
  },
};
