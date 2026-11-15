import { createContext, useContext } from "react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";

/** An app's Settings entry: whether it shows, what it opens and its label. */
export type WorkspaceAppSettingsEntry = {
  visible: boolean;
  onClick: () => void;
  label: string;
};

/** A hook that resolves an app's Settings entry. */
export type UseWorkspaceAppSettingsEntry = (appId: WorkspaceAppId) => WorkspaceAppSettingsEntry;

const NO_ENTRY: WorkspaceAppSettingsEntry = {
  visible: false,
  onClick: () => undefined,
  label: "Settings",
};

function useNoAppSettingsEntry(): WorkspaceAppSettingsEntry {
  return NO_ENTRY;
}

/**
 * Holds the hook that resolves an app's Settings entry. Settings'
 * `SettingsDialogProvider` puts `useWorkspaceAppSettingsEntry` here, so shared UI
 * (the app sidebar) can show the Settings row without importing settings-core.
 * Outside that provider there is no Settings row. The value must stay the same hook
 * for the life of the tree, because it is called as a hook.
 */
export const AppSettingsEntryContext =
  createContext<UseWorkspaceAppSettingsEntry>(useNoAppSettingsEntry);

/** The app's Settings entry from the nearest {@link AppSettingsEntryContext}. */
export function useAppSettingsEntry(appId: WorkspaceAppId): WorkspaceAppSettingsEntry {
  const useEntry = useContext(AppSettingsEntryContext);
  return useEntry(appId);
}
