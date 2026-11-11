import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import type { ConfirmDialogRequest } from "@/hooks/use-confirm-dialog";
import { useSelectableListState } from "@/hooks/use-selectable-list-state";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { WorkspaceActionButton } from "@/hooks/workspace-list-controller-types";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import { CollectionMoveDialog } from "@/ui/collection-move-dialog";
import { CollectionSelect } from "@/ui/collection-select";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import type { CalendarEventListSelection } from "@/calendar-core/src/calendar-event-list";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  unifiedSearchOccurrences,
  type CalendarSearchResults,
} from "@/calendar-core/src/calendar-search";
import type { AgendaDay } from "@/lib/calendar-elements/utils/agenda-days";
import { canWriteCalendarCollection } from "@/calendar-core/src/calendar-collection-write";

/** The list's rows in order, each with its event's calendar (period list or search results). */
export function calendarListRows(
  days: readonly AgendaDay[],
  searchResults: CalendarSearchResults | null,
): ReadonlyMap<string, string | undefined> {
  const rows = new Map<string, string | undefined>();
  if (searchResults) {
    for (const hit of unifiedSearchOccurrences(searchResults)) rows.set(hit.key, hit.calendarId);
  } else {
    for (const item of days.flatMap((day) => day.items)) rows.set(item.id, item.event.calendarId);
  }
  return rows;
}

type UseCalendarListSelectionArgs = {
  L: CalendarUILabels;
  /** `calendarListRows`: the rows in list order, with their calendars. */
  rows: ReadonlyMap<string, string | undefined>;
  /** A new period, query or mode ends a multi-selection. */
  resetKey: string;
  /** The occurrence open in the detail pane. */
  activeKey: string;
  calendars: readonly CalendarInfo[];
  openEvent: (key: string) => void;
  /** Closes the open event: it goes with a delete, and a move gives it a new id. */
  leaveEvent: () => void;
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
  rows,
  resetKey,
  activeKey,
  calendars,
  openEvent,
  leaveEvent,
  requestConfirm,
  deleteEvents,
  moveEvents,
}: UseCalendarListSelectionArgs) {
  const visibleIds = useMemo(() => [...rows.keys()], [rows]);
  const calendarIdOf = useCallback((key: string) => rows.get(key), [rows]);
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
        if (keys.includes(activeKey)) leaveEvent();
        deleteEvents(keys);
        exitSelection();
      },
    });
  }, [L, activeKey, deleteEvents, exitSelection, leaveEvent, requestConfirm, writableKeys]);

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
    return only ?? { id: "", name: "", color: "" };
  }, [calendarIdOf, moveKeys, moveTargets]);

  const moveDialog = (
    <CollectionMoveDialog
      open={moveKeys !== null}
      value={moveValue}
      title={L.selectionMoveToCalendar}
      description={L.selectionMoveDescription}
      fieldLabel={L.selectionMoveField}
      confirmLabel={L.selectionMove}
      cancelLabel={L.cancel}
      contentClassName="calendar-dialog-surface"
      isSame={(draft, value) => draft.id === value.id}
      renderPicker={({ id, draft, setDraft }) => (
        <CollectionSelect
          id={id}
          items={moveTargets}
          value={draft.id}
          dot={<CollectionColorDot />}
          color={draft.color}
          triggerLabel={draft.name || L.selectionMoveField}
          accessibleName={L.selectionMoveField}
          triggerVariant="ghost"
          onValueChange={(next) =>
            setDraft(moveTargets.find((target) => target.id === next) ?? draft)
          }
        />
      )}
      onClose={() => setMoveKeys(null)}
      onConfirm={(target) => {
        if (!moveKeys) return;
        const movesOpenEvent = moveKeys.includes(activeKey);
        if (movesOpenEvent) leaveEvent();
        moveEvents(moveKeys, target.id);
        exitSelection(movesOpenEvent ? undefined : activeKey);
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
