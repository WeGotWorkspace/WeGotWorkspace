import type { CSSProperties, ReactElement } from "react";
import { notebookDotColor } from "@/notes-core/src/notes-notebook-color";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { NotesNotebookColorIcon } from "@/notes-core/src/notes-notebook-color-icon";
import { cn } from "@/lib/utils";
import "@/notes-core/src/notes-notebook-select.css";

/** Sentinel so Create stays out of the selected notebook value (Calendar Select pattern). */
export const NOTES_CREATE_NOTEBOOK_VALUE = "__create_notebook__";

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
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
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
  return [{ id: current.id ?? current.name, name: current.name, color: current.color }, ...notebooks];
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

function NotebookSelectOption({ notebook }: { notebook: NotesNotebookSelectItem }) {
  return (
    <span
      className="notes-notebook-select__option"
      style={{ "--collection-row-color": notebookDotColor(notebook) } as CSSProperties}
    >
      <NotesNotebookColorIcon />
      <span className="notes-notebook-select__name">{notebook.name}</span>
    </span>
  );
}

export function NotesNotebookSelect({
  notebooks,
  value,
  labels,
  ariaLabel,
  disabled = false,
  className,
  onNotebookChange,
  onCreateNotebook,
}: NotesNotebookSelectProps): ReactElement {
  const items = notebooksWithCurrent(notebooks, value);
  const selected = resolveNotebookSelectValue(items, value);

  return (
    <Select
      value={selected}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === NOTES_CREATE_NOTEBOOK_VALUE) {
          onCreateNotebook?.();
          return;
        }
        const notebook = items.find((item) => item.id === next);
        if (!notebook) return;
        if (notebook.id === value.id || notebook.name === value.name) return;
        onNotebookChange(notebook);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn("notes-notebook-select", className)}
        aria-label={ariaLabel ?? labels.toolbarMoveToNotebook}
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((notebook) => (
          <SelectItem key={notebook.id} value={notebook.id}>
            <NotebookSelectOption notebook={notebook} />
          </SelectItem>
        ))}
        {onCreateNotebook ? (
          <>
            {items.length > 0 ? (
              <SelectSeparator className="notes-notebook-select__separator" />
            ) : null}
            <SelectItem value={NOTES_CREATE_NOTEBOOK_VALUE}>{labels.addNotebook}</SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
