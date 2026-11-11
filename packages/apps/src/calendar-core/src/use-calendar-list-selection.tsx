import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import type { ConfirmDialogRequest } from "@/hooks/use-confirm-dialog";
import { useSelectableListState } from "@/hooks/use-selectable-list-state";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { WorkspaceActionButton } from "@/hooks/workspace-list-controller-types";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import { NotesChangeNotebookDialog } from "@/notes-core/src/notes-change-notebook-dialog";
import type { CalendarEventListSelection } from "@/calendar-core/src/calendar-event-list";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { canWriteCalendarCollection } from "@/calendar-core/src/calendar-collection-write";

type UseCalendarListSelectionArgs = {
  L: CalendarUILabels;
  /** The rows in list order (the period list or the search results). */
  visibleIds: string[];
  /** A new period, query or mode ends a multi-selection. */
  resetKey: string;
  /** The occurrence open in the detail pane. */
  activeKey: string;
  calendars: readonly CalendarInfo[];
  /** The calendar a row's event is in. */
  calendarIdOf: (key: string) => string | undefined;
  openEvent: (key: string) => void;
  requestConfirm: (request: ConfirmDialogRequest) => void;
  deleteEvents: (keys: readonly string[]) => void;
  moveEvents: (keys: readonly string[], calendarId: string) => void;
};

/**
 * Calendar list mode's multi-select, as in Tasks, Notes and Contacts: Cmd/Shift-click
 * and long-press pick rows; the floating bar (phones) and the detail pane offer Move to
 * calendar and Delete for the picked events in writable calendars.
 */
export function useCalendarListSelection({
  L,
  visibleIds,
  resetKey,
  activeKey,
  calendars,
  calendarIdOf,
  openEvent,
  requestConfirm,
  deleteEvents,
  moveEvents,
}: UseCalendarListSelectionArgs) {
  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    selectSingle,
  } = useSelectableListState({ visibleIds, onPrimarySelect: openEvent });
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null);

  // Another period, query or mode ends a multi-selection; the open event stays picked.
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  useEffect(() => {
    setSelectionMode(false);
    if (activeKeyRef.current) selectSingle(activeKeyRef.current);
    else setSelectedIds([]);
  }, [resetKey, selectSingle, setSelectedIds, setSelectionMode]);

  const multiSelected = selectionMode || selectedIds.length > 1;
  const writableKeys = useMemo(
    () =>
      selectedIds.filter((key) =>
        canWriteCalendarCollection(calendars.find((entry) => entry.id === calendarIdOf(key))),
      ),
    [calendarIdOf, calendars, selectedIds],
  );

  const requestDelete = useCallback(() => {
    const keys = writableKeys;
    requestConfirm({
      title: L.deleteEventsConfirmTitle(keys.length),
      description: L.deleteEventsConfirmBody(keys.length),
      confirmLabel: L.delete,
      cancelLabel: L.cancel,
      variant: "destructive",
      onConfirm: () => {
        deleteEvents(keys);
        exitSelection();
      },
    });
  }, [L, deleteEvents, exitSelection, requestConfirm, writableKeys]);

  const actionButtons = useMemo<WorkspaceActionButton[]>(
    () =>
      writableKeys.length === 0
        ? []
        : [
            {
              label: L.selectionMoveToCalendar,
              icon: <CalendarDays className="size-4" />,
              onClick: () => setMoveKeys(writableKeys),
            },
            {
              label: L.delete,
              icon: <Trash2 className="size-4" />,
              onClick: requestDelete,
              severity: "danger" as const,
            },
          ],
    [L, requestDelete, writableKeys],
  );
  const { selectionBar, selectionBarButtons } = useWorkspaceSelectionPresentation({
    selectedIds,
    selectionMode,
    activeId: activeKey,
    exitSelection,
    actionButtons,
    doneLabel: L.selectionDone,
  });

  const moveTargets = useMemo(
    () =>
      calendars
        .filter((calendar) => canWriteCalendarCollection(calendar))
        .map(({ id, name, color }) => ({ id, name, color })),
    [calendars],
  );
  // One shared calendar is the starting value; a mixed selection starts empty.
  const moveValue = useMemo(() => {
    const ids = new Set((moveKeys ?? []).map(calendarIdOf));
    const only = ids.size === 1 ? moveTargets.find((target) => ids.has(target.id)) : undefined;
    return only ?? { name: "" };
  }, [calendarIdOf, moveKeys, moveTargets]);

  const moveDialog = (
    <NotesChangeNotebookDialog
      open={moveKeys !== null}
      notebooks={moveTargets}
      value={moveValue}
      title={L.selectionMoveToCalendar}
      fieldLabel={L.selectionMoveField}
      description={L.selectionMoveDescription}
      confirmLabel={L.selectionMove}
      labels={{
        addNotebook: L.newCalendar,
        toolbarMoveToNotebook: L.selectionMoveToCalendar,
        selectionMoveToNotebook: L.selectionMoveToCalendar,
        changeNotebookConfirm: L.selectionMove,
        dialogCancel: L.cancel,
      }}
      contentClassName="calendar-dialog-surface"
      onClose={() => setMoveKeys(null)}
      onNotebookChange={(target) => {
        if (moveKeys) moveEvents(moveKeys, target.id);
        exitSelection(activeKey);
      }}
    />
  );

  const selection: CalendarEventListSelection = {
    selectedIds,
    selectionMode,
    onItemClick: handleSelect,
    onItemLongPress: enterSelectionFor,
  };

  return { selection, multiSelected, selectedIds, selectionBar, selectionBarButtons, moveDialog };
}
