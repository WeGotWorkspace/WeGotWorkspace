import type {
  RecurrenceScopeChoice,
  RecurrenceScopeRequest,
} from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarRecurrenceScopeDialogState } from "@/calendar-core/src/calendar-recurrence-scope-dialog";

type ScopeResolve = (scope: RecurrenceScopeChoice | null) => void;

/**
 * Opens the scope dialog and resolves with the choice, or null when it is dismissed. A
 * new prompt settles the one still open with null, so a drag or click never hangs on it.
 */
export function promptRecurrenceScope(
  request: RecurrenceScopeRequest,
  pending: { current: ScopeResolve | null },
  setDialog: (dialog: CalendarRecurrenceScopeDialogState) => void,
): Promise<RecurrenceScopeChoice | null> {
  return new Promise((resolve) => {
    const previous = pending.current;
    pending.current = null;
    previous?.(null);

    let settled = false;
    const settle: ScopeResolve = (scope) => {
      if (settled) return;
      settled = true;
      if (pending.current === settle) pending.current = null;
      setDialog(null);
      resolve(scope);
    };
    pending.current = settle;

    // Opens after the pointer gesture that asked, so Radix does not take it as a dismiss.
    window.setTimeout(() => {
      if (settled) return;
      setDialog({
        // Legacy "update" maps to edit chrome; RSVP keeps its own copy.
        action: request.action === "update" ? "edit" : request.action,
        ...(request.description ? { description: request.description } : {}),
        resolve: settle,
      });
    }, 0);
  });
}
