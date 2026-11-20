/**
 * When the user last touched any tab of this browser (pointer, key, wheel, touch), shared
 * across tabs through localStorage, so the tab that holds the push stream knows the user is
 * busy in another one. The push stream slows from 3 s to 6 s while nobody uses the workspace
 * (#2294, shared hosting traffic budget, Epic #2284).
 */

const STORAGE_KEY = "wgw.activity.lastInputAt";
/** A write per input would thrash storage; one every few seconds is enough. */
const WRITE_EVERY_MS = 5_000;
/** No input in any tab for this long counts as idle. */
export const USER_IDLE_AFTER_MS = 120_000;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

let lastInputAt = Date.now();
let lastWriteAt = 0;
let installed = false;
const resumeListeners = new Set<() => void>();

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function onInput(): void {
  const now = Date.now();
  const wasIdle = userIsIdle(now);
  lastInputAt = now;
  if (now - lastWriteAt >= WRITE_EVERY_MS) {
    lastWriteAt = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // Storage blocked: this tab still knows its own input.
    }
  }
  if (wasIdle) for (const listener of resumeListeners) listener();
}

/** Starts listening, once per tab. No-op outside the browser. */
export function installUserActivity(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { capture: true, passive: true });
  }
}

/** Epoch ms of the last input in any tab of this browser. */
export function lastUserInputAt(): number {
  return Math.max(lastInputAt, readStored());
}

export function userIsIdle(now = Date.now()): boolean {
  return now - lastUserInputAt() >= USER_IDLE_AFTER_MS;
}

/** Runs in this tab when the user acts again after being idle; returns the unsubscribe function. */
export function onUserResumed(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

/** Tests only: forget this tab's state and listeners. */
export function resetUserActivityForTests(now = Date.now()): void {
  if (installed && typeof window !== "undefined") {
    for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
  }
  installed = false;
  lastInputAt = now;
  lastWriteAt = 0;
  resumeListeners.clear();
}
