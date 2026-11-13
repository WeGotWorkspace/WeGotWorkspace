import { createContext, useContext } from "react";
import type { SettingsPanel } from "@/settings-core/src/settings-registry";
import type { BuiltinPanelId } from "@/settings-core/src/settings-types";

export type SettingsDialogApi = {
  openPanel: (id: BuiltinPanelId) => void;
  openRegisteredPanel: (panel: SettingsPanel) => void;
};

export const SettingsDialogContext = createContext<SettingsDialogApi>({
  openPanel: () => undefined,
  openRegisteredPanel: () => undefined,
});

export function useSettingsDialog(): SettingsDialogApi {
  return useContext(SettingsDialogContext);
}
