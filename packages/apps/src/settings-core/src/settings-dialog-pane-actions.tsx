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

export type SettingsDialogPaneSave = {
  save: () => void | Promise<void>;
  disabled: boolean;
};

type SettingsDialogPaneActions = {
  /** One entry per slice: a panel can hold several slices, each with its own Save. */
  register: (key: symbol, next: SettingsDialogPaneSave | null) => void;
};

/**
 * The footer's one Save for every registered slice: enabled when any slice has changes, and
 * runs the Save of each slice that has them, in registration order.
 */
function combinePaneSaves(
  entries: Map<symbol, SettingsDialogPaneSave>,
): SettingsDialogPaneSave | null {
  if (entries.size === 0) return null;
  const all = [...entries.values()];
  return {
    disabled: all.every((entry) => entry.disabled),
    save: async () => {
      for (const entry of [...entries.values()]) {
        if (!entry.disabled) await entry.save();
      }
    },
  };
}

const SettingsDialogPaneActionsContext = createContext<SettingsDialogPaneActions | null>(null);

export function SettingsDialogPaneActionsProvider({
  children,
  onSaveChange,
}: {
  children: ReactNode;
  onSaveChange: (next: SettingsDialogPaneSave | null) => void;
}): ReactNode {
  const entriesRef = useRef(new Map<symbol, SettingsDialogPaneSave>());
  const register = useCallback(
    (key: symbol, next: SettingsDialogPaneSave | null) => {
      if (next) entriesRef.current.set(key, next);
      else entriesRef.current.delete(key);
      onSaveChange(combinePaneSaves(entriesRef.current));
    },
    [onSaveChange],
  );
  const api = useMemo(() => ({ register }), [register]);
  return (
    <SettingsDialogPaneActionsContext.Provider value={api}>
      {children}
    </SettingsDialogPaneActionsContext.Provider>
  );
}

/**
 * No-op outside the settings dialog. Panes use this so the footer owns Save; with several
 * slices on one panel (Calendar: display and availability) the footer saves each changed one.
 */
export function useRegisterSettingsDialogSave(
  save: () => void | Promise<void>,
  disabled: boolean,
): void {
  const ctx = useContext(SettingsDialogPaneActionsContext);
  const [key] = useState(() => Symbol("settings-dialog-save"));
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!ctx) return;
    ctx.register(key, {
      save: () => saveRef.current(),
      disabled,
    });
    return () => ctx.register(key, null);
  }, [ctx, disabled, key]);
}

export function useSettingsDialogPaneSaveState(): {
  paneSave: SettingsDialogPaneSave | null;
  onSaveChange: (next: SettingsDialogPaneSave | null) => void;
} {
  const [paneSave, setPaneSave] = useState<SettingsDialogPaneSave | null>(null);
  const saveRef = useRef<SettingsDialogPaneSave | null>(null);
  const onSaveChange = useCallback((next: SettingsDialogPaneSave | null) => {
    saveRef.current = next;
    setPaneSave((current) => {
      const nextHas = next != null;
      const currentHas = current != null;
      if (nextHas === currentHas && (next?.disabled ?? true) === (current?.disabled ?? true)) {
        return current;
      }
      return next
        ? {
            save: () => saveRef.current?.save(),
            disabled: next.disabled,
          }
        : null;
    });
  }, []);
  return { paneSave, onSaveChange };
}
