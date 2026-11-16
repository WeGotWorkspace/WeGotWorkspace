import { getConnectivitySnapshot } from "@/lib/offline/browser-online";

/** Load state of a settings section that reads its values from the server. */
export type ServerSettingsPhase = "loading" | "offline" | "error" | "ready";

/**
 * One read of a server-side settings section. `quiet` refreshes a ready section in place: it
 * never shows loading or errors and never drops unsaved edits. A newer request (counted in
 * `requestRef`) wins over an older one that answers late.
 */
export async function loadServerSettings<T>({
  quiet,
  requestRef,
  read,
  isDirty,
  isOffline,
  setPhase,
  apply,
}: {
  quiet: boolean;
  requestRef: { current: number };
  read: () => Promise<T>;
  isDirty: () => boolean;
  isOffline: (error: unknown) => boolean;
  setPhase: (phase: ServerSettingsPhase) => void;
  apply: (value: T) => void;
}): Promise<void> {
  const request = ++requestRef.current;
  if (!getConnectivitySnapshot()) {
    if (!quiet) setPhase("offline");
    return;
  }
  if (!quiet) setPhase("loading");
  try {
    const next = await read();
    if (request !== requestRef.current || (quiet && isDirty())) return;
    apply(next);
  } catch (error) {
    if (request !== requestRef.current || quiet) return;
    setPhase(isOffline(error) ? "offline" : "error");
  }
}
