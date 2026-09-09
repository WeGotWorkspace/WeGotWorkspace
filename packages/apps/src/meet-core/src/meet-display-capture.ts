/** Browser bits used to decide whether Meet can offer display capture. */
export type DisplayCaptureEnvironment = {
  mediaDevices?: { getDisplayMedia?: unknown } | null;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

function readNavigator(): DisplayCaptureEnvironment {
  if (typeof navigator === "undefined") return {};
  return {
    mediaDevices: navigator.mediaDevices,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/**
 * iPhone/iPad (including iPadOS 13+ desktop-UA spoofing). WebKit on those
 * devices does not capture the display for arbitrary web apps.
 */
export function isIosWebKitClient(env: DisplayCaptureEnvironment = readNavigator()): boolean {
  const userAgent = env.userAgent ?? "";
  const platform = env.platform ?? "";
  const maxTouchPoints = env.maxTouchPoints ?? 0;
  if (/iP(hone|od|ad)/.test(userAgent) || /iP(hone|od|ad)/.test(platform)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * True when this browsing context can offer a working Share screen control.
 * iOS Safari/WebKit historically stubs or omits getDisplayMedia, so the
 * toolbar must not offer a no-op action there.
 */
export function isDisplayCaptureSupported(
  env: DisplayCaptureEnvironment = readNavigator(),
): boolean {
  if (isIosWebKitClient(env)) return false;
  return typeof env.mediaDevices?.getDisplayMedia === "function";
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
