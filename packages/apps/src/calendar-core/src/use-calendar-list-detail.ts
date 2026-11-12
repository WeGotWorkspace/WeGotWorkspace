import { useEffect, useRef } from "react";
import type { ConfirmDialogRequest } from "@/hooks/use-confirm-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import type { WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type {
  CalendarEditorSaveOptions,
  CalendarEditorState,
} from "@/calendar-core/src/use-calendar-controller";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import { useCalendarEditorAutosave } from "@/calendar-core/src/use-calendar-editor-autosave";

type UseCalendarListDetailArgs = {
  L: CalendarUILabels;
  listLayout: boolean;
  /** An event is open (preview or editor). */
  eventSelected: boolean;
  /** The open event is in its editor (not a read-only preview). */
  interactiveEdit: boolean;
  /** The open event is one date of a repeating event. */
  recurring: boolean;
  /** Delete from the read-only preview, when it may. */
  deleteFromPreview?: () => void;
  editor: CalendarEditorState | null;
  saveEditor: (scope?: RecurrenceEditScope, options?: CalendarEditorSaveOptions) => void;
  deleteEditorEvent: () => void;
  /** Clears the open event (its preview and any times draft). */
  clearEvent: () => void;
  closeEventDetail: () => void;
  requestConfirm: (request: ConfirmDialogRequest) => void;
};

/**
 * List mode's detail pane: it slides over the list on phones, saves as you type (the
 * grid's popover keeps Save), and its header Delete asks first.
 */
export function useCalendarListDetail({
  L,
  listLayout,
  eventSelected,
  interactiveEdit,
  recurring,
  deleteFromPreview,
  editor,
  saveEditor,
  deleteEditorEvent,
  clearEvent,
  closeEventDetail,
  requestConfirm,
}: UseCalendarListDetailArgs) {
  const workspaceRef = useRef<WorkspaceAppHandle>(null);
  /** Below `md` the detail pane slides over the list and needs a back button. */
  const detailOverlay = useIsMobile();
  useEffect(() => {
    if (!listLayout) return;
    if (eventSelected) workspaceRef.current?.openMobileDetail();
    else workspaceRef.current?.closeMobileDetail();
  }, [eventSelected, listLayout]);

  /** Phones: clear the selection inside the overlay's slide-out (as Tasks does), so it
   * slides the event away, not an emptied pane with only its header. */
  const leaveEventDetail = (clear: () => void) => {
    if (detailOverlay && workspaceRef.current) workspaceRef.current.closeMobileDetail(clear);
    else clear();
  };

  const autosave = useCalendarEditorAutosave({
    editor,
    enabled: listLayout && interactiveEdit,
    saveEditor,
  });
  const deleteEditedEvent = () => {
    autosave.cancel();
    deleteEditorEvent();
    clearEvent();
  };

  const deleteNow =
    interactiveEdit && editor?.mode === "edit" ? deleteEditedEvent : deleteFromPreview;
  /** Detail header Delete: asks first. A repeating occurrence already asks which ones
   * (the scope dialog), so it goes straight on. */
  const detailDelete =
    deleteNow &&
    (recurring
      ? () => leaveEventDetail(deleteNow)
      : () =>
          requestConfirm({
            title: L.deleteEventConfirmTitle,
            description: L.deleteEventConfirmBody,
            confirmLabel: L.delete,
            cancelLabel: L.cancel,
            variant: "destructive",
            onConfirm: () => leaveEventDetail(deleteNow),
          }));

  return {
    workspaceRef,
    detailOverlay,
    leaveEventDetail,
    /** Back on phones: leave the open event. */
    goBack: () => leaveEventDetail(closeEventDetail),
    /** Leaves the open event for a batch delete or move: its pending autosave is dropped
     * (a move takes the open form along instead). */
    leaveForBatchWrite: () => {
      autosave.cancel();
      leaveEventDetail(closeEventDetail);
    },
    autosave,
    deleteEditedEvent,
    detailDelete,
  };
}
