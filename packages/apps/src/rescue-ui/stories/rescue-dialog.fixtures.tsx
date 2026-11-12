import { FilePlus } from "lucide-react";
import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import { notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import type { RescueLabels, RescueView } from "@/rescue-ui/rescue-adapter";

/**
 * A stand-in Notes adapter for the stories: Notes does not park refused writes
 * yet (#1565), so these words and glyphs only show the shared dialog with
 * another app's noun and icon.
 */
export type StoryNotebook = { id: string; name: string; color: string };
export type StoryNote = { title: string };

export const storyNotebooks: StoryNotebook[] = [
  { id: "inbox", name: "Inbox", color: "#2f9e44" },
  { id: "journal", name: "Journal", color: "#5f3dc4" },
  { id: "work", name: "Work notes", color: "#e8590c" },
];

const quoted = (name: string, fallback: string) => (name ? `“${name}”` : fallback);

export const notebookRescueLabels: RescueLabels = {
  step: (step, total) => `Notebook ${step} of ${total}`,
  title: (count, name) =>
    count === 1
      ? `A note from ${quoted(name, "a notebook")}`
      : `${count} notes from ${quoted(name, "a notebook")}`,
  reason: (name, reason) =>
    reason === "readOnly"
      ? `You can only view ${quoted(name, "this notebook")} now, so your offline changes could not be saved there. Choose where to keep them.`
      : `${quoted(name, "This notebook")} was deleted or is no longer shared with you, so your offline changes could not be saved there. Choose where to keep them.`,
  editsAsNew: "Edited notes are kept as new notes.",
  destinationLabel: "Move to",
  newContainer: "New notebook",
  newContainerLabel: "Name of the new notebook",
  newContainerName: (name, reason) =>
    !name ? "Rescued notes" : reason === "readOnly" ? `${name} (copy)` : name,
  move: (count) => (count === 1 ? "Move note" : `Move ${count} notes`),
  discard: (count) => (count === 1 ? "Discard note" : `Discard ${count} notes`),
  later: "Decide later",
  notice: (count, names) => {
    const notes = count === 1 ? "1 note" : `${count} notes`;
    if (names.length > 1) return `${notes} from ${names.length} notebooks need a new notebook`;
    return count === 1
      ? `A note from “${names[0]}” needs a new notebook`
      : `${notes} from “${names[0]}” need a new notebook`;
  },
  review: "Review",
  moved: (count, name) =>
    count === 1 ? `Moved 1 note to “${name}”` : `Moved ${count} notes to “${name}”`,
  discarded: (count) => (count === 1 ? "Discarded 1 note" : `Discarded ${count} notes`),
  failed: "Some notes could not be moved. They are still waiting for a notebook.",
  openElsewhere: "These notes are open in another Notes tab. Choose where to keep them there.",
};

export const notebookRescueView: RescueView<StoryNotebook> = {
  labels: notebookRescueLabels,
  surfaceClassName: "notes-dialog-surface",
  // Notes' notebook colour dot, as its sidebar shows it.
  containerIcon: (notebook) => <CollectionColorDot color={notebookDotColor(notebook)} />,
  noticeIcon: <FilePlus className="callout__icon" aria-hidden />,
};

let order = 0;

export function parkedNote(
  title: string,
  notebook: string,
  reason: ParkedWrite["reason"] = "gone",
  kind: ParkedWrite["kind"] = "create",
): ParkedWrite<StoryNote> {
  order += 1;
  const entityId = `story-note-${order}`;
  return {
    id: `notes:${entityId}`,
    domain: "notes",
    entityId,
    kind,
    reason,
    containerId: `notebook-${notebook}`,
    containerName: notebook,
    title,
    item: { title },
    parkedAt: order,
  };
}
