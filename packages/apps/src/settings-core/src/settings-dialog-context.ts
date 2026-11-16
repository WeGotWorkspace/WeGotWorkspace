import { createContext, useContext } from "react";
import type { SettingsPanel } from "@/settings-core/src/settings-registry";
import type { BuiltinPanelId } from "@/lib/models/settings-types";

export type SettingsDialogApi = {
  openPanel: (id: BuiltinPanelId) => void;
  openRegisteredPanel: (panel: SettingsPanel) => void;
  /** Go to another panel from inside one: swaps the open dialog, or navigates the Settings page. */
  showPanel: (id: BuiltinPanelId) => void;
};

export const SettingsDialogContext = createContext<SettingsDialogApi>({
  openPanel: () => undefined,
  openRegisteredPanel: () => undefined,
  showPanel: () => undefined,
});

export function useSettingsDialog(): SettingsDialogApi {
  return useContext(SettingsDialogContext);
}
