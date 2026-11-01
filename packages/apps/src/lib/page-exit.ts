/**
 * Page exit signal for writes the UI already shows as done (#1794).
 *
 * Listeners run on `beforeunload`, unless another handler cancelled it to ask the user
 * whether to leave (the Meet leave prompt): then they wait for `pagehide`, so a user who
 * stays keeps Undo. `beforeunload` comes first and leaves this page running while the next
 * one loads, so a write that reads IndexedDB before its request still gets it out on a
 * reload. `pagehide` is the fallback and the last point where script runs. Listeners must
 * be idempotent.
 *
 * The window listeners are only attached while at least one listener is registered:
 * a standing `beforeunload` listener can keep a page out of the back/forward cache. The
 * `beforeunload` listener is attached again on each registration so it runs after a leave
 * prompt that was already in place and can see that prompt's cancel.
 */
type PageExitListener = () => void;

const listeners = new Set<PageExitListener>();
let exiting = false;
let pageshowAttached = false;

function runExit(): void {
  exiting = true;
  for (const listener of [...listeners]) listener();
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  // A legacy prompt sets `returnValue` to a message instead of calling `preventDefault()`.
  const legacyPrompt = typeof event.returnValue === "string" && event.returnValue !== "";
  if (event.defaultPrevented || legacyPrompt) return;
  runExit();
}

function handlePageShow(): void {
  exiting = false;
}

function attach(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pagehide", runExit);
  if (!pageshowAttached) {
    pageshowAttached = true;
    window.addEventListener("pageshow", handlePageShow);
  }
}

function detach(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("pagehide", runExit);
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
 * True once the listeners ran, until the page is shown again. A leave prompt that was
 * cancelled never sets it, so later requests do not get `keepalive`.
 */
export function pageIsExiting(): boolean {
  return exiting;
}
