/** Meet low data mode: a device choice, read by calls and edited in Settings. */
export const meetLowDataLabels = {
  mode: "Low data mode",
  hint: "Send a smaller picture. Show video from at most two people.",
  settingsSaved: "Meet settings saved",
  settingsSaveError: "Could not save Meet settings",
} as const;

const STORAGE_KEY = "wgw.meet.lowData";
const CHANGE_EVENT = "wgw-meet-low-data";

export function readMeetLowData(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Store the choice; false when storage rejects it (private mode, full quota). */
export function writeMeetLowData(enabled: boolean): boolean {
  if (typeof localStorage === "undefined") return false;
  let stored = true;
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    stored = false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return stored;
}

export function subscribeMeetLowData(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
