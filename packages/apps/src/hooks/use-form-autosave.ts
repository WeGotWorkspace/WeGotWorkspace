import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useReportAutosaveStatus, type AutosaveStatus } from "@/ui/autosave-status";

/** Long enough to batch typing, short enough that a choice feels saved at once. */
export const FORM_AUTOSAVE_DELAY_MS = 400;

/**
 * Preference forms save themselves (suite norm): each edit the user makes runs `save`
 * after a short pause, so typing is one save, not one per key. A pending save still
 * runs when the form goes away (Done, Escape, another pane). Saves run one after the
 * other, never side by side. Only user edits count: `reset` and `setValue` do not save.
 *
 * Status for a surrounding dialog: saving from the first edit until the last save is
 * done; then saved, or unsaved when the form is still dirty (`save` resets the form
 * once the values are stored, so a rejected or failed save stays dirty).
 */
export function useFormAutosave<T extends FieldValues>(
  form: UseFormReturn<T>,
  save: () => Promise<void>,
  delay = FORM_AUTOSAVE_DELAY_MS,
): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const runningRef = useRef(0);
  const [busy, setBusy] = useState(false);

  const flush = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    runningRef.current += 1;
    queueRef.current = queueRef.current
      .then(() => saveRef.current())
      // `save` reports its own errors; the next save still runs.
      .catch(() => undefined)
      .finally(() => {
        runningRef.current -= 1;
        if (runningRef.current === 0 && timerRef.current === undefined) setBusy(false);
      });
  }, []);

  useEffect(() => {
    const subscription = form.watch((_values, { type }) => {
      if (type !== "change") return;
      setBusy(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delay);
    });
    return () => subscription.unsubscribe();
  }, [delay, flush, form]);

  useEffect(() => flush, [flush]);

  const status: AutosaveStatus = busy ? "saving" : form.formState.isDirty ? "unsaved" : "saved";
  useReportAutosaveStatus(status);
}
