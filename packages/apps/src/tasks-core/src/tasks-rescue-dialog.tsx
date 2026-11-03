import { useEffect, useId, useMemo, useState } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/button/src/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { CalendarPickerMenuItem } from "@/lib/calendar-event-calendar-picker";
import type { ParkedTask, TaskRescueTarget } from "@/lib/offline/tasks/tasks-parked-writes";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListIcon } from "@/tasks-core/src/tasks-list-icon";
import type { TaskList } from "@/tasks-core/src/tasks-types";
import "./tasks-conflict-dialog.css";
import "./tasks-rescue-dialog.css";

export type TasksRescueDialogProps = {
  open: boolean;
  writes: ParkedTask[];
  /** Lists the person can add tasks to. */
  lists: TaskList[];
  busy?: boolean;
  labels: TasksUILabels;
  onMove: (ids: string[], target: TaskRescueTarget) => void;
  onDiscard: (ids: string[]) => void;
  /** Closing without a choice keeps the tasks parked. */
  onLater: () => void;
};

/** The menu value for "New list"; never a real list id. */
const NEW_LIST = "__new-list__";

function suggestedName(writes: ParkedTask[], L: TasksUILabels): string {
  const names = new Set(writes.map((write) => write.containerName));
  const [only] = names;
  return L.rescueNewListName(names.size === 1 && only ? only : "");
}

/**
 * Asks where tasks the server refused should go (#1825): an existing list the
 * person can write to, a new list, or nowhere (discard). One dialog for all of
 * them, each with a checkbox. The destination is one menu of lists plus "New
 * list", like the calendar file import.
 */
export function TasksRescueDialog({
  open,
  writes,
  lists,
  busy = false,
  labels: L,
  onMove,
  onDiscard,
  onLater,
}: TasksRescueDialogProps) {
  const id = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A new list keeps the rescued tasks together; an existing list is one pick away.
  const [destinationId, setDestinationId] = useState(NEW_LIST);
  const [newName, setNewName] = useState("");
  const writeIds = writes.map((write) => write.id).join("\n");

  // A new set of tasks starts with all of them ticked and a fresh suggestion.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(writeIds.split("\n").filter(Boolean)));
    setDestinationId(NEW_LIST);
    setNewName(suggestedName(writes, L));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per set of tasks
  }, [open, writeIds]);

  // A list that stops being writable while the dialog is open is no longer a choice.
  useEffect(() => {
    if (destinationId !== NEW_LIST && !lists.some((list) => list.id === destinationId)) {
      setDestinationId(NEW_LIST);
    }
  }, [destinationId, lists]);

  const ids = useMemo(
    () => writes.filter((write) => selected.has(write.id)).map((write) => write.id),
    [selected, writes],
  );
  const creating = destinationId === NEW_LIST;
  const selectedList = lists.find((list) => list.id === destinationId);
  const destinationName = creating ? L.rescueNewList : (selectedList?.name ?? "");
  const target: TaskRescueTarget | null = creating
    ? newName.trim()
      ? { newListName: newName.trim() }
      : null
    : selectedList
      ? { listId: selectedList.id }
      : null;

  const toggle = (writeId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(writeId);
      else next.delete(writeId);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onLater()}>
      <DialogContent className="tasks-dialog-surface tasks-conflict-dialog tasks-rescue-dialog">
        <DialogHeader>
          <DialogTitle>{L.rescueTitle(writes.length)}</DialogTitle>
          <DialogDescription>{L.rescueDescription}</DialogDescription>
        </DialogHeader>
        <ul className="tasks-rescue-dialog__items">
          {writes.map((write) => (
            <li key={write.id} className="tasks-rescue-dialog__item">
              <Checkbox
                id={`${id}-${write.id}`}
                checked={selected.has(write.id)}
                onCheckedChange={(value) => toggle(write.id, value === true)}
                disabled={busy}
              />
              <Label htmlFor={`${id}-${write.id}`} className="tasks-rescue-dialog__item-label">
                <span className="tasks-rescue-dialog__item-title">
                  {write.title || L.untitledTask}
                </span>
                <span className="tasks-rescue-dialog__item-meta">
                  {L.rescueFrom(write.containerName, write.reason)}
                  {write.kind === "edit" ? `. ${L.rescueAsNewTask}` : ""}
                </span>
              </Label>
            </li>
          ))}
        </ul>
        <div className="tasks-rescue-dialog__destination">
          <FieldLabelRow label={L.rescueDestinationLabel} htmlFor={`${id}-destination`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ColorSwatchTrigger
                  id={`${id}-destination`}
                  icon={selectedList ? <TaskListIcon list={selectedList} /> : undefined}
                  showSwatch={false}
                  size="md"
                  label={`${L.rescueDestinationLabel}: ${destinationName}`}
                  className="tasks-rescue-dialog__destination-trigger"
                  disabled={busy}
                >
                  {destinationName}
                </ColorSwatchTrigger>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="calendar-event-dialog__calendar-menu calendar-event-dialog__calendar-menu--match-trigger"
              >
                {lists.map((list) => (
                  <CalendarPickerMenuItem
                    key={list.id}
                    name={list.name}
                    icon={<TaskListIcon list={list} />}
                    selected={destinationId === list.id}
                    onSelect={() => setDestinationId(list.id)}
                  />
                ))}
                {lists.length > 0 ? <DropdownMenuSeparator /> : null}
                <CalendarPickerMenuItem
                  name={L.rescueNewList}
                  selected={creating}
                  onSelect={() => setDestinationId(NEW_LIST)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </FieldLabelRow>
          {creating ? (
            <FieldLabelRow label={L.rescueNewListLabel} htmlFor={`${id}-new-name`}>
              <Input
                id={`${id}-new-name`}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                disabled={busy}
              />
            </FieldLabelRow>
          ) : null}
        </div>
        <DialogFooter className="tasks-conflict-dialog__actions tasks-rescue-dialog__actions">
          <Button
            className="tasks-rescue-dialog__discard"
            variant="outline"
            onClick={() => onDiscard(ids)}
            disabled={busy || ids.length === 0}
          >
            {L.rescueDiscard(ids.length)}
          </Button>
          <div className="tasks-rescue-dialog__choices">
            <Button variant="outline" onClick={onLater} disabled={busy}>
              {L.rescueLater}
            </Button>
            <Button
              variant="primary"
              onClick={() => target && onMove(ids, target)}
              disabled={busy || ids.length === 0 || !target}
            >
              {L.rescueMove(ids.length)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The way back to the dialog while tasks wait for a list, in the view header. */
export function TasksRescueEntry({
  count,
  labels: L,
  onOpen,
}: {
  count: number;
  labels: TasksUILabels;
  onOpen: () => void;
}) {
  if (count === 0) return null;
  return (
    <Button
      className="tasks-rescue-entry"
      variant="outline"
      size="md"
      icon={<ListPlus aria-hidden />}
      label={L.rescueEntry(count)}
      onClick={onOpen}
    />
  );
}
