import { flushSync } from "react-dom";

/** Set on `<html>` while a collection-detail view transition is running. */
export const VIEW_TRANSITION_ROOT_CLASS = "workspace-vt-detail";

/** Resolves when the in-flight collection-detail View Transition finishes (or immediately). */
let viewTransitionGate: Promise<void> = Promise.resolve();

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run `task` after the current collection-detail View Transition snapshot callback.
 * History updates inside `startViewTransition` are ignored on iOS / Chrome, which
 * left `/notes/all` in the URL and the overlay on the empty detail state.
 */
export function afterViewTransition(task: () => void): void {
  if (
    typeof document === "undefined" ||
    !document.documentElement.classList.contains(VIEW_TRANSITION_ROOT_CLASS)
  ) {
    task();
    return;
  }
  void viewTransitionGate.then(task);
}

function armViewTransitionGate(): () => void {
  let released = false;
  let release: () => void = () => {};
  viewTransitionGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/**
 * Apply a DOM update inside `document.startViewTransition` when the browser
 * supports it and motion is allowed. Falls back to a synchronous update.
 *
 * Calendar range swaps still avoid this API (Lit update-cycle deadlock).
 * Collection list/detail is React + flushSync, so VT is safe here.
 */
export function runViewTransition(update: () => void | Promise<void>): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    prefersReducedMotion()
  ) {
    void Promise.resolve(update());
    return;
  }

  const root = document.documentElement;
  root.classList.add(VIEW_TRANSITION_ROOT_CLASS);
  const releaseGate = armViewTransitionGate();
  const finish = () => {
    root.classList.remove(VIEW_TRANSITION_ROOT_CLASS);
    releaseGate();
  };

  try {
    const transition = document.startViewTransition(async () => {
      let pending: void | Promise<void> | undefined;
      flushSync(() => {
        pending = update();
      });
      if (pending != null) await pending;
    });
    void transition.finished.then(finish, finish);
  } catch {
    finish();
    void Promise.resolve(update());
  }
}
