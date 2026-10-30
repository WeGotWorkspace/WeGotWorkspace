/**
 * Page exit signal for writes the UI already shows as done (#1794).
 *
 * `beforeunload` fires first and leaves this page running while the next one loads, so a
 * write started there still has time for async work before its request. `pagehide` is the
 * last point where script runs (and the only one on some mobile browsers). Listeners run on
 * both events and must be idempotent.
 *
 * The window listeners are only attached while at least one listener is registered:
 * a standing `beforeunload` listener can keep a page out of the back/forward cache.
 */
type PageExitListener = () => void;

const listeners = new Set<PageExitListener>();
let exiting = false;
let attached = false;
let pageshowAttached = false;

function handleExit(): void {
  exiting = true;
  for (const listener of [...listeners]) listener();
}

function handlePageShow(): void {
  exiting = false;
}

function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("beforeunload", handleExit);
  window.addEventListener("pagehide", handleExit);
  if (!pageshowAttached) {
    pageshowAttached = true;
    window.addEventListener("pageshow", handlePageShow);
  }
}

function detach(): void {
  if (!attached || typeof window === "undefined") return;
  attached = false;
  window.removeEventListener("beforeunload", handleExit);
  window.removeEventListener("pagehide", handleExit);
}

/** Calls `listener` when the page is reloaded, closed or left. Returns the unsubscribe. */
export function onPageExit(listener: PageExitListener): () => void {
  listeners.add(listener);
  attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

/**
 * True from `beforeunload` or `pagehide` until the page is shown again. It stays set when
 * another `beforeunload` handler keeps the page open, which only costs a keepalive flag.
 */
export function pageIsExiting(): boolean {
  return exiting;
}
