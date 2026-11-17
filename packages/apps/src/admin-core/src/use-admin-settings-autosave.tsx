import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { useReportAutosaveStatus, type AutosaveStatus } from "@/ui/autosave-status";
import type { AdminSettingsFormState } from "@/admin-core/src/admin-settings-form-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

type Patch = Partial<AdminSettingsFormState>;

export type AdminSettingsEditor = {
  /** A choice (switch, dropdown, restore default): saves after a short pause. */
  choose: (patch: Patch) => void;
  /** Typing in a field: saves after a short pause, or at once when the field is left. */
  type: (patch: Patch) => void;
  /**
   * Typing in a field that must not save half-typed (secrets, limits): updates the form and
   * saves only when the field is left.
   */
  hold: (patch: Patch) => void;
  /** Leaving a field (blur, Enter): saves what is still waiting, at once. */
  commit: () => void;
  /** Runs `task` after every save already started; drops the save still waiting on the timer. */
  afterSaves: (task: () => Promise<void>) => Promise<void>;
};

const AdminSettingsEditorContext = createContext<AdminSettingsEditor | null>(null);

/**
 * Server settings save themselves (suite norm, like Settings): every change saves after
 * {@link FORM_AUTOSAVE_DELAY_MS}, and leaving a text field saves at once. The tag shows
 * Saving from the first keystroke. Saves run one after the other, and a pending one still
 * runs when the page changes. Reports Saving / Saved / Unsaved to the
 * surrounding {@link AutosaveStatusProvider}.
 */
function useAdminSettingsAutosave(controller: AdminControllerState): AdminSettingsEditor {
  const formRef = useRef(controller.settingsForm);
  formRef.current = controller.settingsForm;
  const saveRef = useRef(controller.actions.autosaveSettings);
  saveRef.current = controller.actions.autosaveSettings;
  const setForm = controller.setSettingsForm;

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typedRef = useRef(false);
  const heldRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const runningRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const flush = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    runningRef.current += 1;
    queueRef.current = queueRef.current
      // Read the form when the save starts: it holds every edit made until then.
      .then(() => {
        const form = formRef.current;
        // A secret still being typed waits for its field to be left; the stored one stays.
        return saveRef.current(
          heldRef.current ? { ...form, mailDeliverySmtpPassword: "", turnSecret: "" } : form,
        );
      })
      .then((ok) => setFailed(!ok))
      .finally(() => {
        runningRef.current -= 1;
        if (runningRef.current === 0 && timerRef.current === undefined) setBusy(false);
      });
  }, []);

  const schedule = useCallback(
    (delay: number) => {
      setBusy(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delay);
    },
    [flush],
  );

  const choose = useCallback(
    (patch: Patch) => {
      setForm((prev) => ({ ...prev, ...patch }));
      schedule(FORM_AUTOSAVE_DELAY_MS);
    },
    [schedule, setForm],
  );

  const type = useCallback(
    (patch: Patch) => {
      typedRef.current = true;
      setForm((prev) => ({ ...prev, ...patch }));
      schedule(FORM_AUTOSAVE_DELAY_MS);
    },
    [schedule, setForm],
  );

  const hold = useCallback(
    (patch: Patch) => {
      typedRef.current = true;
      heldRef.current = true;
      setForm((prev) => ({ ...prev, ...patch }));
      setBusy(true);
    },
    [setForm],
  );

  const commit = useCallback(() => {
    if (!typedRef.current || (timerRef.current === undefined && !heldRef.current)) return;
    typedRef.current = false;
    heldRef.current = false;
    // After this render, so the save reads the last keystroke.
    schedule(0);
  }, [schedule]);

  const afterSaves = useCallback((task: () => Promise<void>) => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    typedRef.current = false;
    heldRef.current = false;
    if (runningRef.current === 0) setBusy(false);
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => {});
    return run;
  }, []);

  // A pending save still runs when Admin closes.
  useEffect(() => flush, [flush]);

  const status: AutosaveStatus = busy ? "saving" : failed ? "unsaved" : "saved";
  useReportAutosaveStatus(status);

  return useMemo(
    () => ({ choose, type, hold, commit, afterSaves }),
    [choose, type, hold, commit, afterSaves],
  );
}

/**
 * Gives the panes inside an editor; leaving any text field inside (blur, Enter) saves what
 * was typed. The wrapper takes no box (`display: contents`).
 */
export function AdminSettingsAutosave({
  controller,
  children,
}: {
  controller: AdminControllerState;
  children: ReactNode;
}) {
  const editor = useAdminSettingsAutosave(controller);
  return (
    <AdminSettingsEditorContext.Provider value={editor}>
      <div
        className="admin-settings-autosave"
        onBlur={editor.commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") editor.commit();
        }}
      >
        {children}
      </div>
    </AdminSettingsEditorContext.Provider>
  );
}

export function useAdminSettingsEditor(): AdminSettingsEditor {
  const editor = useContext(AdminSettingsEditorContext);
  if (!editor) throw new Error("useAdminSettingsEditor needs <AdminSettingsAutosave>");
  return editor;
}
