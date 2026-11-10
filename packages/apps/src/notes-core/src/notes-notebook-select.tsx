import type { ReactElement } from "react";
import { notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { NotesNotebookColorDot } from "@/notes-core/src/notes-notebook-color-dot";
import type { ControlSize } from "@/ui/control-size";
import { COLLECTION_SELECT_CREATE_VALUE, CollectionSelect } from "@/ui/collection-select";
import { cn } from "@/lib/utils";

/** Sentinel so Create stays out of the selected notebook value (Calendar Select pattern). */
export const NOTES_CREATE_NOTEBOOK_VALUE = COLLECTION_SELECT_CREATE_VALUE;

export type NotesNotebookSelectItem = {
  id: string;
  name: string;
  color?: string | null;
};

export type NotesNotebookSelectValue = {
  id?: string;
  name: string;
  color?: string | null;
};

export type NotesNotebookSelectProps = {
  notebooks: NotesNotebookSelectItem[];
  value: NotesNotebookSelectValue;
  labels: Pick<NotesUILabels, "addNotebook" | "toolbarMoveToNotebook">;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /**
   * `swatch` reuses ColorSwatchTrigger (icon + chevron, no caption) — same chrome as
   * CalendarEventCalendarPicker. `labeled` keeps the Select trigger with visible name.
   * `ghost` is the notebook name in its own colour with a small chevron and no
   * chrome (the note detail eyebrow).
   */
  triggerVariant?: "labeled" | "swatch" | "ghost";
  /** Dialog fields use `sm` (32px). Toolbar / action bar keep default `md`. */
  size?: ControlSize;
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  /** Show *Create notebook* as the chosen value (import dialog create mode). */
  createSelected?: boolean;
};

export function notebookSelectValueForNotes(
  notes: ReadonlyArray<{ id: string; notebook: string; notebookId?: string }>,
  ids: readonly string[] | undefined,
  notebooks: readonly NotesNotebookSelectItem[],
): NotesNotebookSelectValue {
  const sample = ids?.length ? notes.find((note) => note.id === ids[0]) : undefined;
  if (!sample) return { name: "" };
  const match = notebooks.find(
    (notebook) =>
      notebook.id === sample.notebookId ||
      notebook.id === sample.notebook ||
      notebook.name === sample.notebook,
  );
  return {
    id: sample.notebookId ?? match?.id,
    name: match?.name ?? sample.notebook,
    color: match?.color,
  };
}

export function notebooksWithCurrent(
  notebooks: NotesNotebookSelectItem[],
  current: NotesNotebookSelectValue,
): NotesNotebookSelectItem[] {
  if (!current.name.trim()) return notebooks;
  if (
    notebooks.some(
      (notebook) =>
        notebook.id === current.id ||
        notebook.id === current.name ||
        notebook.name === current.name,
    )
  ) {
    return notebooks;
  }
  return [
    { id: current.id ?? current.name, name: current.name, color: current.color },
    ...notebooks,
  ];
}

export function notebookSelectionEquals(
  left: { id?: string; name: string },
  right: { id?: string; name: string },
): boolean {
  if (left.id && right.id) return left.id === right.id;
  return left.name === right.name;
}

export function resolveNotebookSelectValue(
  notebooks: NotesNotebookSelectItem[],
  current: { id?: string; name: string },
): string {
  const match = notebooks.find(
    (notebook) =>
      notebook.id === current.id || notebook.id === current.name || notebook.name === current.name,
  );
  return match?.id ?? current.id ?? current.name;
}

export function pendingMoveAfterNotebookCreate(
  created: { name: string } | undefined,
  pendingNoteIds: string[] | null | undefined,
): { ids: string[]; notebook: string } | null {
  if (!created?.name || !pendingNoteIds?.length) return null;
  return { ids: pendingNoteIds, notebook: created.name };
}

export function NotesNotebookSelect({
  notebooks,
  value,
  labels,
  ariaLabel,
  disabled = false,
  className,
  triggerVariant = "labeled",
  size = "md",
  onNotebookChange,
  onCreateNotebook,
  createSelected = false,
}: NotesNotebookSelectProps): ReactElement {
  const items = notebooksWithCurrent(notebooks, value);
  const selected =
    createSelected && onCreateNotebook
      ? NOTES_CREATE_NOTEBOOK_VALUE
      : resolveNotebookSelectValue(items, value);
  // Prefer the notebook name so swatch chrome stays labeled for AT / tooltip.
  const accessibleName = ariaLabel ?? (value.name.trim() || labels.toolbarMoveToNotebook);

  return (
    <CollectionSelect
      items={items.map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        color: notebookDotColor(notebook),
      }))}
      value={selected}
      dot={<NotesNotebookColorDot />}
      color={notebookDotColor(value)}
      triggerLabel={value.name}
      accessibleName={accessibleName}
      triggerVariant={triggerVariant}
      size={size}
      className={cn(
        "notes-notebook-select",
        triggerVariant !== "labeled" && `notes-notebook-select--${triggerVariant}`,
        className,
      )}
      menuClassName="collection-ghost-select__menu"
      disabled={disabled}
      create={
        onCreateNotebook ? { label: labels.addNotebook, onSelect: onCreateNotebook } : undefined
      }
      onValueChange={(next) => {
        const notebook = items.find((item) => item.id === next);
        if (!notebook) return;
        if (notebook.id === value.id || notebook.name === value.name) return;
        onNotebookChange(notebook);
      }}
    />
  );
}
