import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import { useSettingsReachability } from "@/settings-core/src/settings-reachability";
import { getSettingsPanel, type SettingsPanel } from "@/settings-core/src/settings-registry";
import { settingsNavigateTarget } from "@/settings-core/src/settings-section";
import type { BuiltinPanelId } from "@/settings-core/src/settings-types";
import { useSettingsAPI } from "@/settings-core/src/use-settings-api";
import { useSettingsController } from "@/settings-core/src/use-settings-controller";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  SettingsDialogPaneActionsProvider,
  useSettingsDialogPaneSaveState,
} from "@/settings-core/src/settings-dialog-pane-actions";
import "@/settings-core/src/settings-workspace.css";

export type SettingsDialogApi = {
  openPanel: (id: BuiltinPanelId) => void;
  openRegisteredPanel: (panel: SettingsPanel) => void;
};

const SettingsDialogContext = createContext<SettingsDialogApi>({
  openPanel: () => undefined,
  openRegisteredPanel: () => undefined,
});

export function useSettingsDialog(): SettingsDialogApi {
  return useContext(SettingsDialogContext);
}

export function SettingsDialogProvider({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [panel, setPanel] = useState<SettingsPanel | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);

  const openRegisteredPanel = useCallback((next: SettingsPanel) => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    restoreFocusRef.current = true;
    setPanel(next);
  }, []);

  const openPanel = useCallback(
    (id: BuiltinPanelId) => {
      const next = getSettingsPanel(id);
      if (!next) return;
      openRegisteredPanel(next);
    },
    [openRegisteredPanel],
  );

  const closeDialog = useCallback((restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setPanel(null);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        openerRef.current?.focus();
      });
    }
  }, []);

  const openInSettings = useCallback(() => {
    if (!panel) return;
    const target = settingsNavigateTarget(panel.id);
    closeDialog(false);
    void router.navigate({ ...target }).then(() => {
      router.history.flush?.();
      requestAnimationFrame(() => {
        const heading = document.querySelector(".settings-workspace .view-header__title");
        if (heading instanceof HTMLElement) {
          heading.focus();
        }
      });
    });
  }, [closeDialog, panel, router]);

  const api = useMemo(() => ({ openPanel, openRegisteredPanel }), [openPanel, openRegisteredPanel]);
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (restoreFocusRef.current) {
      openerRef.current?.focus();
    }
  }, []);

  return (
    <SettingsDialogContext.Provider value={api}>
      {children}
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        {panel ? (
          panel.needsSettingsApi ? (
            <SettingsDialogApiFrame
              panel={panel}
              onDismiss={() => closeDialog(true)}
              onOpenInSettings={openInSettings}
              onCloseAutoFocus={onCloseAutoFocus}
            />
          ) : (
            <SettingsDialogLocalFrame
              panel={panel}
              onDismiss={() => closeDialog(true)}
              onOpenInSettings={openInSettings}
              onCloseAutoFocus={onCloseAutoFocus}
            />
          )
        ) : null}
      </Dialog>
    </SettingsDialogContext.Provider>
  );
}

type SettingsDialogFrameProps = {
  panel: SettingsPanel;
  onDismiss: () => void;
  onOpenInSettings: () => void;
  onCloseAutoFocus: (event: Event) => void;
  children: ReactNode;
};

function SettingsDialogChrome({
  panel,
  onDismiss,
  onOpenInSettings,
  onCloseAutoFocus,
  children,
}: SettingsDialogFrameProps) {
  const { paneSave, onSaveChange } = useSettingsDialogPaneSaveState();

  return (
    <DialogContent
      className="sm:max-w-2xl settings-workspace"
      aria-describedby={undefined}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <DialogHeader>
        <DialogTitle>{panel.label}</DialogTitle>
      </DialogHeader>
      <SettingsDialogPaneActionsProvider onSaveChange={onSaveChange}>
        {children}
      </SettingsDialogPaneActionsProvider>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="settings-dialog-footer__open"
          label="Open in Settings"
          onClick={onOpenInSettings}
        />
        <Button type="button" variant="outline" label="Cancel" onClick={onDismiss} />
        {paneSave ? (
          <Button
            type="button"
            variant="primary"
            label="Save"
            disabled={paneSave.disabled}
            onClick={() => void paneSave.save()}
          />
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}

function SettingsDialogLocalFrame({
  panel,
  onDismiss,
  onOpenInSettings,
  onCloseAutoFocus,
}: Omit<SettingsDialogFrameProps, "children">) {
  const ctx = useSettingsReachability();

  return (
    <SettingsDialogChrome
      panel={panel}
      onDismiss={onDismiss}
      onOpenInSettings={onOpenInSettings}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <SettingsPanelHost panelId={panel.id} ctx={ctx} />
    </SettingsDialogChrome>
  );
}

function SettingsDialogApiFrame({
  panel,
  onDismiss,
  onOpenInSettings,
  onCloseAutoFocus,
}: Omit<SettingsDialogFrameProps, "children">) {
  const { phase, error, retry, successVersion, data, operations } = useSettingsAPI();
  const ctx = useSettingsReachability();

  return (
    <SettingsDialogChrome
      panel={panel}
      onDismiss={onDismiss}
      onOpenInSettings={onOpenInSettings}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <WorkspaceLiveAppShell
        phase={phase}
        error={error}
        retry={retry}
        errorTitle="Could not load settings"
        successVersion={successVersion}
        render={() => (
          <SettingsDialogApiBody panel={panel} data={data} operations={operations} ctx={ctx} />
        )}
      />
    </SettingsDialogChrome>
  );
}

function SettingsDialogApiBody({
  panel,
  data,
  operations,
  ctx,
}: {
  panel: SettingsPanel;
  data: ReturnType<typeof useSettingsAPI>["data"];
  operations: ReturnType<typeof useSettingsAPI>["operations"];
  ctx: ReturnType<typeof useSettingsReachability>;
}) {
  const controller = useSettingsController({ data, operations });
  return (
    <SettingsPanelHost
      panelId={panel.id}
      ctx={ctx}
      slices={{
        profile: controller.profile,
        mail: controller.mail,
        assistants: controller.assistants,
        memberships: controller.memberships,
      }}
    />
  );
}
