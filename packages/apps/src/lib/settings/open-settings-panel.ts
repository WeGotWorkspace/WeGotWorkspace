import { createContext, useContext } from "react";

/** Opens a Settings panel by id, or null outside Settings' provider (nothing to open). */
export type OpenSettingsPanel = ((panelId: string) => void) | null;

/**
 * `SettingsDialogProvider` puts its panel opener here, so shared UI (the Project filter)
 * can offer "Manage Projects" without importing settings-core.
 */
export const OpenSettingsPanelContext = createContext<OpenSettingsPanel>(null);

export function useOpenSettingsPanel(): OpenSettingsPanel {
  return useContext(OpenSettingsPanelContext);
}
