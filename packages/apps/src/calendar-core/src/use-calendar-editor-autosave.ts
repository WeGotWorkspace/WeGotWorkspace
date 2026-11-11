import { useCallback, useEffect, useRef } from "react";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { calendarEventFormIsValid } from "@/calendar-core/src/calendar-editor-model";
import type {
  CalendarEditorSaveOptions,
  CalendarEditorState,
} from "@/calendar-core/src/use-calendar-controller";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";

type SaveEditor = (scope?: RecurrenceEditScope, options?: CalendarEditorSaveOptions) => void;

function editorKey(editor: CalendarEditorState): string | null {
  return editor.mode === "edit" ? `${editor.eventId}:${editor.recurrenceId ?? ""}` : null;
}

/**
 * Saves the open event a moment after each change, like a task or a note (list mode's
 * detail pane). A pending save is sent before another event opens, the pane closes or the
 * page unmounts; `cancel` drops it (the event is being deleted).
 */
export function useCalendarEditorAutosave({
  editor,
  enabled,
  saveEditor,
}: {
  editor: CalendarEditorState | null;
  enabled: boolean;
  saveEditor: SaveEditor;
}) {
  const saveRef = useRef(saveEditor);
  saveRef.current = saveEditor;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<CalendarEditorState | null>(null);
  /** The editor's form as last seen, so only edits (not opening an event) save. */
  const seenRef = useRef<{ key: string; form: CalendarEditorState["form"] } | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
  }, []);

  const flush = useCallback(() => {
    const target = pendingRef.current;
    cancel();
    if (target) saveRef.current(undefined, { keepOpen: true, target });
  }, [cancel]);

  useEffect(() => {
    const key = enabled && editor ? editorKey(editor) : null;
    if (!editor || !key) {
      flush();
      seenRef.current = null;
      return;
    }
    if (seenRef.current?.key !== key) {
      flush();
      seenRef.current = { key, form: editor.form };
      return;
    }
    if (seenRef.current.form === editor.form) return;
    seenRef.current.form = editor.form;
    if (!calendarEventFormIsValid(editor.form)) {
      cancel();
      return;
    }
    pendingRef.current = editor;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, FORM_AUTOSAVE_DELAY_MS);
  }, [cancel, editor, enabled, flush]);

  useEffect(() => flush, [flush]);

  return { flush, cancel };
}
