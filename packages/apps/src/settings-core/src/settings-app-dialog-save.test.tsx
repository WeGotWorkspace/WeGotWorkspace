/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import {
  SettingsDialogPaneActionsProvider,
  type SettingsDialogPaneSave,
} from "@/settings-core/src/settings-dialog-pane-actions";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import {
  getSettingsPanel,
  resetSettingsRegistryForTests,
} from "@/settings-core/src/settings-registry";
import { BUILTIN_PANEL_IDS } from "@/settings-core/src/settings-types";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

beforeEach(() => {
  resetSettingsRegistryForTests();
  registerBuiltinSettings();
});

afterEach(() => {
  cleanup();
  resetSettingsRegistryForTests();
  window.localStorage.clear();
});

const appPanels = BUILTIN_PANEL_IDS.filter((id) => {
  resetSettingsRegistryForTests();
  registerBuiltinSettings();
  return getSettingsPanel(id)?.appId != null;
});

describe("app settings dialog", () => {
  it("covers every app panel", () => {
    expect(appPanels).toEqual(
      expect.arrayContaining(["calendar", "tasks", "contacts", "notes", "docs", "meet"]),
    );
  });

  // Every app pane hands its Save to the dialog footer (`useSettingsPrefsForm` does).
  it.each(appPanels)("%s pane gives the dialog footer a Save", (panelId) => {
    let paneSave: SettingsDialogPaneSave | null = null;
    render(
      <SettingsDialogPaneActionsProvider onSaveChange={(next) => (paneSave = next)}>
        <SettingsPanelHost panelId={panelId} ctx={{}} />
      </SettingsDialogPaneActionsProvider>,
    );
    expect(paneSave).not.toBeNull();
    expect(paneSave!.disabled).toBe(true);
  });
});
