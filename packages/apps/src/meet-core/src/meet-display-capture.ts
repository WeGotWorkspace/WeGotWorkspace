/**
 * True when this browsing context can offer Share screen.
 * Feature-detects `getDisplayMedia` only — no user-agent sniffing — so iOS
 * Safari (which omits the API) hides the control, and browsers that later add
 * it get the action automatically.
 */
export function isDisplayCaptureSupported(
  mediaDevices: { getDisplayMedia?: unknown } | null | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.mediaDevices,
): boolean {
  return typeof mediaDevices?.getDisplayMedia === "function";
}

/** User dismissed the display-media picker (not a platform limitation). */
export function isDisplayCaptureUserCancel(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "AbortError";
}

/** getDisplayMedia is missing, unimplemented, or has no capturable surface. */
export function isDisplayCaptureUnsupportedError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const name = error instanceof Error ? error.name : "";
  return name === "NotSupportedError" || name === "NotFoundError";
}
