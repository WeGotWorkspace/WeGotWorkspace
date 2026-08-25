import { useCallback, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import {
  readIcsFile,
  runCalendarIcsImport,
  type CalendarIcsImportDestination,
} from "@/calendar-core/src/calendar-ics-import";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarAPIOperations, CalendarInfo } from "@/calendar-core/src/calendar-types";

export type UseCalendarIcsImportOptions = {
  operations?: CalendarAPIOperations;
  labels: Pick<
    CalendarUILabels,
    | "importFileInvalid"
    | "toastImportFailed"
    | "toastImportPartial"
    | "toastImportSuccess"
    | "toastImportOffline"
  >;
  onCalendarCreated?: (calendar: CalendarInfo) => void;
  onMutated?: () => void;
};

export type CalendarIcsImportState = {
  canImportEvents: boolean;
  importFile: File | null;
  importDialogOpen: boolean;
  importDialogBusy: boolean;
  importDialogError: string | null;
  beginImport: (file: File) => void;
  closeImportDialog: () => void;
  submitImportDialog: (file: File, destination: CalendarIcsImportDestination) => void;
};

export function useCalendarIcsImport({
  operations,
  labels: L,
  onCalendarCreated,
  onMutated,
}: UseCalendarIcsImportOptions): CalendarIcsImportState {
  const { show, showError } = useAppToast();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDialogBusy, setImportDialogBusy] = useState(false);
  const [importDialogError, setImportDialogError] = useState<string | null>(null);

  const canImportEvents = Boolean(operations?.importEvents);
  const importDialogOpen = importFile !== null;

  const beginImport = useCallback(
    (file: File) => {
      if (!canImportEvents) return;
      setImportDialogError(null);
      setImportFile(file);
    },
    [canImportEvents],
  );

  const closeImportDialog = useCallback(() => {
    if (importDialogBusy) return;
    setImportFile(null);
    setImportDialogError(null);
  }, [importDialogBusy]);

  const submitImportDialog = useCallback(
    (file: File, destination: CalendarIcsImportDestination) => {
      if (!operations?.importEvents) return;
      setImportDialogBusy(true);
      setImportDialogError(null);
      void (async () => {
        try {
          const icsText = await readIcsFile(file);
          if (icsText.trim() === "") {
            setImportDialogError(L.importFileInvalid);
            return;
          }
          const result = await runCalendarIcsImport(operations, icsText, destination);
          if (result.createdCalendar) {
            onCalendarCreated?.(result.createdCalendar);
          }
          if (result.list.length === 0) {
            setImportDialogError(L.toastImportFailed);
            return;
          }
          show(result.errors.length > 0 ? L.toastImportPartial : L.toastImportSuccess);
          setImportFile(null);
          onMutated?.();
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim() !== ""
              ? error.message
              : L.toastImportFailed;
          setImportDialogError(message);
          showError(message.includes("internet") ? L.toastImportOffline : L.toastImportFailed);
        } finally {
          setImportDialogBusy(false);
        }
      })();
    },
    [L, onCalendarCreated, onMutated, operations, show, showError],
  );

  return {
    canImportEvents,
    importFile,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    beginImport,
    closeImportDialog,
    submitImportDialog,
  };
}
