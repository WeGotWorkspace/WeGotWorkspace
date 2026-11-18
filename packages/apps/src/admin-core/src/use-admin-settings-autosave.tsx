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
type FormKey = keyof AdminSettingsFormState;

/**
 * Fields that save only when the admin leaves them (blur, Enter), never on a pause: a
 * half-typed secret, limit, port, path or server list must not reach the server (a
 * prefix of a password would replace the real one; a daily limit of "1" caps the hourly
 * one). Until then, other saves send their last saved value.
 */
export const ADMIN_SAVE_ON_LEAVE: ReadonlySet<FormKey> = new Set<FormKey>([
  "mailDeliverySmtpPassword",
  "turnSecret",
  "imipHourlyLimit",
  "imipDailyLimit",
  "mailDeliverySmtpPort",
  "baseUri",
  "stunUrls",
  "turnUrls",
]);

export type AdminSettingsEditor = {
  /** A choice (switch, dropdown, restore default): saves after a short pause. */
  choose: (patch: Patch) => void;
  /**
   * Typing in a field: saves after a short pause, or at once when the field is left.
   * Fields in {@link ADMIN_SAVE_ON_LEAVE} wait for the field to be left.
   */
  type: (patch: Patch) => void;
  /** Leaving a field (blur, Enter): saves what is still waiting, at once. */
  commit: () => void;
  /**
   * Clears a stored value (`Clear` next to a secret) after every save already on its way,
   * so a save started by leaving the field cannot land after the clear.
   */
  clear: (key: FormKey, action: (form: AdminSettingsFormState) => Promise<unknown>) => void;
};

const AdminSettingsEditorContext = createContext<AdminSettingsEditor | null>(null);

/**
 * Server settings save themselves (suite norm, like Settings): every change saves after
 * {@link FORM_AUTOSAVE_DELAY_MS}, and leaving a text field saves at once. The tag shows
 * Saving from the first keystroke. Saves run one after the other, and a pending one still
 * runs when the page changes.
 */
function useAdminSettingsAutosave(controller: AdminControllerState): AdminSettingsEditor {
  const formRef = useRef(controller.settingsForm);
  formRef.current = controller.settingsForm;
  const saveRef = useRef(controller.actions.autosaveSettings);
  saveRef.current = controller.actions.autosaveSettings;
  const setForm = controller.setSettingsForm;

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typedRef = useRef(false);
  /** Save-on-leave fields being edited, with the value last saved. */
  const leaveRef = useRef(new Map<FormKey, unknown>());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const runningRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /** The form to send: save-on-leave fields not left yet keep their saved value. */
  const payload = useCallback(
    (): AdminSettingsFormState => ({
      ...formRef.current,
      ...(Object.fromEntries(leaveRef.current) as Patch),
    }),
    [],
  );

  const settle = useCallback(() => {
    if (runningRef.current === 0 && timerRef.current === undefined && leaveRef.current.size === 0) {
      setBusy(false);
    }
  }, []);

  const enqueue = useCallback(
    (work: () => Promise<unknown>) => {
      runningRef.current += 1;
      queueRef.current = queueRef.current
        .then(async () => {
          await work();
        })
        // One failed step must not stop the ones after it (each reports its own error).
        .catch(() => setFailed(true))
        .finally(() => {
          runningRef.current -= 1;
          settle();
        });
    },
    [settle],
  );

  const flush = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    // Read the form when the save starts: it holds every edit made until then.
    enqueue(() => saveRef.current(payload()).then((ok) => setFailed(!ok)));
  }, [enqueue, payload]);

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
      for (const key of Object.keys(patch) as FormKey[]) leaveRef.current.delete(key);
      setForm((prev) => ({ ...prev, ...patch }));
      schedule(FORM_AUTOSAVE_DELAY_MS);
    },
    [schedule, setForm],
  );

  const type = useCallback(
    (patch: Patch) => {
      typedRef.current = true;
      let onLeave = true;
      for (const key of Object.keys(patch) as FormKey[]) {
        if (!ADMIN_SAVE_ON_LEAVE.has(key)) {
          onLeave = false;
        } else if (!leaveRef.current.has(key)) {
          leaveRef.current.set(key, formRef.current[key]);
        }
      }
      setForm((prev) => ({ ...prev, ...patch }));
      if (onLeave) setBusy(true);
      else schedule(FORM_AUTOSAVE_DELAY_MS);
    },
    [schedule, setForm],
  );

  const commit = useCallback(() => {
    if (!typedRef.current) return;
    typedRef.current = false;
    leaveRef.current.clear();
    // After this render, so the save reads the last keystroke.
    schedule(0);
  }, [schedule]);

  const clear = useCallback(
    (key: FormKey, action: (form: AdminSettingsFormState) => Promise<unknown>) => {
      leaveRef.current.delete(key);
      setBusy(true);
      // A save waiting on its timer (leaving the field to click Clear) goes first.
      flush();
      enqueue(() => action(payload()));
    },
    [enqueue, flush, payload],
  );

  // A pending save still runs when Admin closes.
  useEffect(() => flush, [flush]);

  const status: AutosaveStatus = busy ? "saving" : failed ? "unsaved" : "saved";
  useReportAutosaveStatus(status);

  return useMemo(() => ({ choose, type, commit, clear }), [choose, type, commit, clear]);
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
