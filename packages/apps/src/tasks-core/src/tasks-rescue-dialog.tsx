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
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { ParkedTask, TaskRescueTarget } from "@/lib/offline/tasks/tasks-parked-writes";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
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

function suggestedName(writes: ParkedTask[], L: TasksUILabels): string {
  const names = new Set(writes.map((write) => write.containerName));
  const [only] = names;
  return L.rescueNewListName(names.size === 1 && only ? only : "");
}

/**
 * Asks where tasks the server refused should go (#1825): an existing list the
 * person can write to, a new list, or nowhere (discard). One dialog for all of
 * them, each with a checkbox.
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
  // A new list keeps the rescued tasks together; an existing list is one click away.
  const [destination, setDestination] = useState<"existing" | "new">("new");
  const [listId, setListId] = useState("");
  const [newName, setNewName] = useState("");
  const writeIds = writes.map((write) => write.id).join("\n");

  // A new set of tasks starts with all of them ticked and a fresh suggestion.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(writeIds.split("\n").filter(Boolean)));
    setDestination("new");
    setNewName(suggestedName(writes, L));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per set of tasks
  }, [open, writeIds]);

  useEffect(() => {
    if (!lists.some((list) => list.id === listId)) setListId(lists[0]?.id ?? "");
  }, [listId, lists]);

  const ids = useMemo(
    () => writes.filter((write) => selected.has(write.id)).map((write) => write.id),
    [selected, writes],
  );
  const target: TaskRescueTarget | null =
    destination === "existing"
      ? listId
        ? { listId }
        : null
      : newName.trim()
        ? { newListName: newName.trim() }
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
        <RadioGroup
          className="tasks-rescue-dialog__destinations"
          value={destination}
          onValueChange={(value) => setDestination(value as "existing" | "new")}
          disabled={busy}
        >
          <div className="tasks-conflict-dialog__option">
            <RadioGroupItem
              value="existing"
              id={`${id}-existing`}
              disabled={busy || lists.length === 0}
            />
            <div className="tasks-rescue-dialog__destination">
              <Label htmlFor={`${id}-existing`}>{L.rescueToExisting}</Label>
              {lists.length === 0 ? (
                <p className="tasks-rescue-dialog__hint">{L.rescueNoWritableList}</p>
              ) : (
                <Select
                  value={listId}
                  onValueChange={(value) => {
                    setListId(value);
                    setDestination("existing");
                  }}
                  disabled={busy}
                >
                  <SelectTrigger size="md" aria-label={L.rescueListLabel}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="tasks-conflict-dialog__option">
            <RadioGroupItem value="new" id={`${id}-new`} />
            <div className="tasks-rescue-dialog__destination">
              <Label htmlFor={`${id}-new`}>{L.rescueToNew}</Label>
              <Input
                aria-label={L.rescueNewListLabel}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onFocus={() => setDestination("new")}
                disabled={busy}
              />
            </div>
          </div>
        </RadioGroup>
        <DialogFooter className="tasks-conflict-dialog__actions tasks-rescue-dialog__actions">
          <Button
            variant="outline"
            onClick={() => onDiscard(ids)}
            disabled={busy || ids.length === 0}
          >
            {L.rescueDiscard(ids.length)}
          </Button>
          <span className="tasks-rescue-dialog__spacer" />
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
