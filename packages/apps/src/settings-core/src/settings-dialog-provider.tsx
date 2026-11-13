import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/button/src/button";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import { useSettingsReachability } from "@/settings-core/src/settings-reachability";
import { getSettingsPanel, type SettingsPanel } from "@/settings-core/src/settings-registry";
import { settingsNavigateTarget } from "@/settings-core/src/settings-section";
import type { BuiltinPanelId } from "@/settings-core/src/settings-types";
import { useSettingsAPI } from "@/settings-core/src/use-settings-api";
import { useSettingsController } from "@/settings-core/src/use-settings-controller";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { SettingsDialogContext } from "@/settings-core/src/settings-dialog-context";
import { useWorkspaceAppSettingsEntry } from "@/settings-core/src/use-workspace-app-settings-entry";
import { AppSettingsEntryContext } from "@/lib/settings/app-settings-entry";
import "@/settings-core/src/settings-workspace.css";

export {
  useSettingsDialog,
  type SettingsDialogApi,
} from "@/settings-core/src/settings-dialog-context";

/**
 * Where focus goes back to when the dialog closes: the element that opened it, or,
 * for an option in a menu (which is gone once the menu closes), the menu's trigger.
 */
function focusReturnTarget(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null;
  const menu = active.closest('[role="menu"]');
  const triggerId = menu?.getAttribute("aria-labelledby");
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return trigger instanceof HTMLElement ? trigger : active;
}

export function SettingsDialogProvider({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [panel, setPanel] = useState<SettingsPanel | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);

  const openRegisteredPanel = useCallback((next: SettingsPanel) => {
    openerRef.current = focusReturnTarget(document.activeElement);
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
      <AppSettingsEntryContext.Provider value={useWorkspaceAppSettingsEntry}>
        {children}
      </AppSettingsEntryContext.Provider>
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
  return (
    <AutosaveStatusProvider>
      <DialogContent
        className="sm:max-w-2xl settings-workspace"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader end={<AutosaveStatusTag />}>
          <DialogTitle>{panel.label}</DialogTitle>
        </DialogHeader>
        {children}
        <DialogFooter
          start={
            <Button
              type="button"
              variant="ghost"
              label="Open in Settings"
              trailingIcon={<ArrowUpRight aria-hidden />}
              onClick={onOpenInSettings}
            />
          }
        >
          <Button type="button" variant="primary" label="Done" onClick={onDismiss} />
        </DialogFooter>
      </DialogContent>
    </AutosaveStatusProvider>
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
        assistants: controller.assistants,
        memberships: controller.memberships,
      }}
    />
  );
}
