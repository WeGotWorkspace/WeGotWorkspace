import { useEffect, useState } from "react";
import { subscribeSettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

export const DEFAULT_COLLECTION_APPS = ["tasks", "contacts", "notes"] as const;
export type DefaultCollectionApp = (typeof DEFAULT_COLLECTION_APPS)[number];

export type DefaultCollectionPrefs = {
  collectionId?: string;
};

export const DEFAULT_COLLECTION_STORAGE_KEYS: Record<DefaultCollectionApp, string> = {
  tasks: "wgw.ui.tasks.defaultCollection",
  contacts: "wgw.ui.contacts.defaultCollection",
  notes: "wgw.ui.notes.defaultCollection",
};

export type DefaultCollectionAppMeta = {
  label: string;
  description: string;
  fieldLabel: string;
  savedMessage: string;
  saveError: string;
};

export const DEFAULT_COLLECTION_APP_META: Record<DefaultCollectionApp, DefaultCollectionAppMeta> = {
  tasks: {
    label: "Tasks",
    description: "Default list for new tasks",
    fieldLabel: "Default list",
    savedMessage: "Tasks settings saved",
    saveError: "Could not save Tasks settings",
  },
  contacts: {
    label: "Contacts",
    description: "Default address book for new contacts",
    fieldLabel: "Default address book",
    savedMessage: "Contacts settings saved",
    saveError: "Could not save Contacts settings",
  },
  notes: {
    label: "Notes",
    description: "Default notebook for new notes",
    fieldLabel: "Default notebook",
    savedMessage: "Notes settings saved",
    saveError: "Could not save Notes settings",
  },
};

function isStoredCollectionId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseDefaultCollectionPrefs(raw: string | null): DefaultCollectionPrefs {
  if (!raw) return {};
  try {
    const record = JSON.parse(raw) as unknown;
    if (!record || typeof record !== "object") return {};
    const collectionId = (record as { collectionId?: unknown }).collectionId;
    if (!isStoredCollectionId(collectionId)) return {};
    return { collectionId: collectionId.trim() };
  } catch {
    return {};
  }
}

export function readDefaultCollectionPrefs(app: DefaultCollectionApp): DefaultCollectionPrefs {
  try {
    return parseDefaultCollectionPrefs(
      window.localStorage.getItem(DEFAULT_COLLECTION_STORAGE_KEYS[app]),
    );
  } catch {
    return {};
  }
}

export function readDefaultCollectionId(app: DefaultCollectionApp): string | undefined {
  return readDefaultCollectionPrefs(app).collectionId;
}

/** Returns false when the write throws (quota / private mode). */
export function writeDefaultCollectionPrefs(
  app: DefaultCollectionApp,
  prefs: DefaultCollectionPrefs,
): boolean {
  try {
    const collectionId = prefs.collectionId?.trim();
    const payload: DefaultCollectionPrefs = collectionId ? { collectionId } : {};
    window.localStorage.setItem(DEFAULT_COLLECTION_STORAGE_KEYS[app], JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function pickPreferredCollectionId(
  ids: readonly string[],
  preferredId: string | undefined,
): string | undefined {
  if (preferredId && ids.includes(preferredId)) return preferredId;
  return undefined;
}

/**
 * Notes picker id is the notebook name. A rename drops the stored default
 * back to the first personal notebook.
 */
export function preferredCollectionName(
  app: DefaultCollectionApp,
  names: readonly string[],
): string | undefined {
  const stored = readDefaultCollectionId(app);
  return stored && names.includes(stored) ? stored : undefined;
}

export function useDefaultCollectionId(app: DefaultCollectionApp): string | undefined {
  const [collectionId, setCollectionId] = useState(() => readDefaultCollectionId(app));

  useEffect(() => {
    const refresh = () => setCollectionId(readDefaultCollectionId(app));
    return subscribeSettingsSliceSaved((event) => {
      if (event.panelId !== app) return;
      refresh();
    });
  }, [app]);

  return collectionId;
}
