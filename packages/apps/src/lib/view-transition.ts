import { flushSync } from "react-dom";

/** Set on `<html>` while a collection-detail view transition is running. */
export const VIEW_TRANSITION_ROOT_CLASS = "workspace-vt-detail";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  const clearRootClass = () => {
    root.classList.remove(VIEW_TRANSITION_ROOT_CLASS);
  };

  try {
    const transition = document.startViewTransition(async () => {
      let pending: void | Promise<void>;
      flushSync(() => {
        pending = update();
      });
      if (pending != null) await pending;
    });
    void transition.finished.then(clearRootClass, clearRootClass);
  } catch {
    clearRootClass();
    void Promise.resolve(update());
  }
}
