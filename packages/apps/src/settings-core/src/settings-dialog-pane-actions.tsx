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
  register: (next: SettingsDialogPaneSave | null) => void;
};

const SettingsDialogPaneActionsContext = createContext<SettingsDialogPaneActions | null>(null);

export function SettingsDialogPaneActionsProvider({
  children,
  onSaveChange,
}: {
  children: ReactNode;
  onSaveChange: (next: SettingsDialogPaneSave | null) => void;
}): ReactNode {
  const register = useCallback(
    (next: SettingsDialogPaneSave | null) => {
      onSaveChange(next);
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

/** No-op outside the settings dialog. Calendar pane uses this so the footer owns Save. */
export function useRegisterSettingsDialogSave(
  save: () => void | Promise<void>,
  disabled: boolean,
): void {
  const ctx = useContext(SettingsDialogPaneActionsContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!ctx) return;
    ctx.register({
      save: () => saveRef.current(),
      disabled,
    });
    return () => ctx.register(null);
  }, [ctx, disabled]);
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
