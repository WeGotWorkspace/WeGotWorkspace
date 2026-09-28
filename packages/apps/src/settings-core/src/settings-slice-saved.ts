export type SettingsSliceSavedEvent = {
  panelId: string;
  sliceId: string;
};

type SettingsSliceSavedListener = (event: SettingsSliceSavedEvent) => void;

const listeners = new Set<SettingsSliceSavedListener>();

export function notifySettingsSliceSaved(event: SettingsSliceSavedEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeSettingsSliceSaved(listener: SettingsSliceSavedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSettingsSliceSavedForTests(): void {
  listeners.clear();
}
