import { readBrowserOnline } from "@/lib/offline/core/browser-online";

const SESSION_DEBUG_RING_KEY = "wgw.api.session_debug";
const SESSION_DEBUG_RING_MAX = 20;

export function appendSessionDebugRecord(record: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.debug(record.event, record);
  }
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SESSION_DEBUG_RING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    const ring = Array.isArray(parsed) ? parsed.slice(-(SESSION_DEBUG_RING_MAX - 1)) : [];
    ring.push(record);
    window.localStorage.setItem(SESSION_DEBUG_RING_KEY, JSON.stringify(ring));
  } catch {
    // Ignore localStorage debug write failures.
  }
}

/** A logout step failed and the data it should have removed may still be present. */
export function appendLogoutStepFailure(step: string, error: unknown): void {
  appendSessionDebugRecord({
    event: "wgw.logout.step_failed",
    step,
    message: error instanceof Error ? error.message : "unknown",
    online: readBrowserOnline(),
    timestamp: new Date().toISOString(),
  });
}
