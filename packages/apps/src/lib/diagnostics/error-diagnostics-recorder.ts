import { wgwBuildVersion } from "@/lib/diagnostics/build-version";
import { buildErrorDiagnostic } from "@/lib/diagnostics/error-diagnostics-entry";
import { isExpectedFailure } from "@/lib/diagnostics/error-diagnostics-expected";
import {
  appendErrorDiagnostic,
  type ErrorDiagnosticSource,
} from "@/lib/diagnostics/error-diagnostics-store";

/**
 * The one recorder for unexpected browser errors (#2204). The global handlers,
 * the shell error boundary and the router's `defaultOnCatch` feed it. It writes
 * to the on-device buffer only; nothing is sent.
 */

/** One write at a time per tab, so a repeat is counted against the row before it. */
let pending: Promise<void> = Promise.resolve();

/**
 * Chrome reports a ResizeObserver that could not deliver every notification in one
 * frame as a window error. It is harmless and fires in bursts, so it would push the
 * real errors out. It arrives with no error object, only this text.
 */
function isBrowserNoise(event: ErrorEvent): boolean {
  return event.error == null && /^ResizeObserver loop/.test(event.message ?? "");
}

/** An error event without an error object (a cross-origin script, a browser notice). */
function errorFromEvent(event: ErrorEvent): unknown {
  if (event.error != null) return event.error;
  const error = new Error(event.message || "Unknown error");
  error.stack = event.filename ? `    at ${event.filename}:${event.lineno}:${event.colno}` : "";
  return error;
}

export function recordUnexpectedError(
  error: unknown,
  source: ErrorDiagnosticSource,
): Promise<void> {
  if (isExpectedFailure(error)) return pending;
  try {
    const entry = buildErrorDiagnostic(error, source, {
      pathname: typeof location === "undefined" ? "/" : location.pathname,
      build: wgwBuildVersion(),
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      now: new Date(),
    });
    // Recording must never throw: a failing write would only report itself again.
    pending = pending.then(() => appendErrorDiagnostic(entry)).catch(() => undefined);
  } catch {
    // Same: an entry that cannot be built is dropped.
  }
  return pending;
}

/** Resolves once every error recorded so far is written. */
export function flushErrorDiagnostics(): Promise<void> {
  return pending;
}

/** Listen for uncaught errors and unhandled rejections. Returns the uninstall. */
export function installErrorDiagnostics(target: Window): () => void {
  const onError = (event: ErrorEvent) => {
    if (isBrowserNoise(event)) return;
    void recordUnexpectedError(errorFromEvent(event), "error");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    void recordUnexpectedError(event.reason, "unhandledrejection");
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
