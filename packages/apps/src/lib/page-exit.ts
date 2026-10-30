/**
 * Page exit signal for writes the UI already shows as done (#1794).
 *
 * Listeners run on `pagehide` only: it fires when the page really goes away (and is the only
 * signal on some mobile browsers). `beforeunload` can be cancelled by another handler (the
 * Meet leave prompt), so it must not start a write the user can still undo. It only sets the
 * exiting flag, and clears it again at once when `pagehide` did not follow.
 *
 * The window listeners are only attached while at least one listener is registered:
 * a standing `beforeunload` listener can keep a page out of the back/forward cache.
 */
type PageExitListener = () => void;

const listeners = new Set<PageExitListener>();
let exiting = false;
let pageHidden = false;
let attached = false;
let pageshowAttached = false;

function handlePageHide(): void {
  exiting = true;
  pageHidden = true;
  for (const listener of [...listeners]) listener();
}

function handleBeforeUnload(): void {
  exiting = true;
  setTimeout(() => {
    if (!pageHidden) exiting = false;
  }, 0);
}

function handlePageShow(): void {
  exiting = false;
  pageHidden = false;
}

function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pagehide", handlePageHide);
  if (!pageshowAttached) {
    pageshowAttached = true;
    window.addEventListener("pageshow", handlePageShow);
  }
}

function detach(): void {
  if (!attached || typeof window === "undefined") return;
  attached = false;
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("pagehide", handlePageHide);
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
 * True from `beforeunload` (until the next task, if `pagehide` does not follow) or from
 * `pagehide` until the page is shown again.
 */
export function pageIsExiting(): boolean {
  return exiting;
}
