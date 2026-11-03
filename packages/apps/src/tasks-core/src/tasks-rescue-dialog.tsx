import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/button/src/button";
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
import { CalendarPickerMenuItem } from "@/lib/calendar-event-calendar-picker";
import type { ParkedTask, TaskRescueTarget } from "@/lib/offline/tasks/tasks-parked-writes";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListIcon } from "@/tasks-core/src/tasks-list-icon";
import { groupParkedTasks, type TaskRescueGroup } from "@/tasks-core/src/tasks-rescue-groups";
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

/**
 * Asks where tasks the server refused should go (#1825), one list at a time:
 * all tasks that lost the same list share one reason and one choice. With
 * several lists, their dialogs follow each other; "Decide later" skips to the
 * next one and keeps the tasks parked.
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
  const groups = useMemo(() => groupParkedTasks(writes), [writes]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // Every list offered since the dialog opened, so the step count stays put.
  const [offered, setOffered] = useState<ReadonlySet<string>>(new Set());

  // Cleared on close, so a reopened dialog starts with every list waiting.
  useEffect(() => {
    if (open) return;
    setSkipped(new Set());
    setOffered(new Set());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOffered((current) => {
      const missing = groups.filter((group) => !current.has(group.containerId));
      return missing.length === 0
        ? current
        : new Set([...current, ...missing.map((group) => group.containerId)]);
    });
  }, [groups, open]);

  const waiting = groups.filter((group) => !skipped.has(group.containerId));
  const current = waiting[0];
  const total = Math.max(offered.size, groups.length);

  const later = () => {
    if (!current || waiting.length <= 1) onLater();
    else setSkipped((skip) => new Set([...skip, current.containerId]));
  };

  // Moving or discarding the last list on screen while earlier ones were put off
  // leaves only skipped lists: close as "later" so the lock is let go and the
  // header entry can ask about them again.
  const onLaterRef = useRef(onLater);
  useEffect(() => {
    onLaterRef.current = onLater;
  }, [onLater]);
  const onlySkippedLeft = open && groups.length > 0 && waiting.length === 0;
  useEffect(() => {
    if (onlySkippedLeft) onLaterRef.current();
  }, [onlySkippedLeft]);

  return (
    <Dialog open={open && !!current} onOpenChange={(next) => !next && !busy && onLater()}>
      <DialogContent className="tasks-dialog-surface tasks-conflict-dialog tasks-rescue-dialog">
        {current ? (
          <RescueListStep
            key={current.containerId}
            group={current}
            step={total - waiting.length + 1}
            total={total}
            lists={lists}
            busy={busy}
            labels={L}
            onMove={onMove}
            onDiscard={onDiscard}
            onLater={later}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RescueListStep({
  group,
  step,
  total,
  lists,
  busy,
  labels: L,
  onMove,
  onDiscard,
  onLater,
}: {
  group: TaskRescueGroup;
  step: number;
  total: number;
  lists: TaskList[];
  busy: boolean;
  labels: TasksUILabels;
  onMove: (ids: string[], target: TaskRescueTarget) => void;
  onDiscard: (ids: string[]) => void;
  onLater: () => void;
}) {
  const id = useId();
  // A new list keeps the rescued tasks together; an existing list is one pick away.
  const [destinationId, setDestinationId] = useState(NEW_LIST);
  const [newName, setNewName] = useState(() =>
    L.rescueNewListName(group.containerName, group.reason),
  );

  // A list that stops being writable while the dialog is open is no longer a choice.
  useEffect(() => {
    if (destinationId !== NEW_LIST && !lists.some((list) => list.id === destinationId)) {
      setDestinationId(NEW_LIST);
    }
  }, [destinationId, lists]);

  const ids = group.writes.map((write) => write.id);
  const count = ids.length;
  const hasEdits = group.writes.some((write) => write.kind === "edit");

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

  return (
    <>
      <DialogHeader>
        {total > 1 ? (
          <p className="field-label-row__label tasks-rescue-dialog__step">
            {L.rescueStep(step, total)}
          </p>
        ) : null}
        <DialogTitle>{L.rescueListTitle(count, group.containerName)}</DialogTitle>
        <DialogDescription>
          {L.rescueReason(group.containerName, group.reason)}
          {hasEdits ? ` ${L.rescueEditsAsNew}` : ""}
        </DialogDescription>
      </DialogHeader>
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
          severity="danger"
          onClick={() => onDiscard(ids)}
          disabled={busy}
        >
          {L.rescueDiscard(count)}
        </Button>
        <div className="tasks-rescue-dialog__choices">
          <Button variant="outline" onClick={onLater} disabled={busy}>
            {L.rescueLater}
          </Button>
          <Button
            variant="primary"
            onClick={() => target && onMove(ids, target)}
            disabled={busy || !target}
          >
            {L.rescueMove(count)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** The way back to the dialog while tasks wait for a list, in the view header. */
export function TasksRescueEntry({
  lists,
  labels: L,
  onOpen,
}: {
  /** How many lists have tasks waiting. */
  lists: number;
  labels: TasksUILabels;
  onOpen: () => void;
}) {
  if (lists === 0) return null;
  return (
    <Button
      className="tasks-rescue-entry"
      variant="outline"
      size="md"
      icon={<ListPlus aria-hidden />}
      label={L.rescueEntry(lists)}
      onClick={onOpen}
    />
  );
}
