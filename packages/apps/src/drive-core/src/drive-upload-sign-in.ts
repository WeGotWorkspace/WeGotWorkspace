import { wgwHasAuthenticatedSession } from "@/lib/api/wgw/http";
import { buildWgwLoginHref } from "@/lib/api/wgw/route-guard";

/**
 * *Retry* on an `auth` failure (#1522): when the session is gone, the user
 * signs in first and comes back to the Uploads view, which then sends the
 * `auth` files back to the queue. With a session still in place there is
 * nothing to sign in to, so the files go back to the queue at once.
 */
const RETRY_AFTER_SIGN_IN_KEY = "wgw.drive.uploads.retry-after-sign-in";
const UPLOADS_PATH = "/drive?view=uploads";

export function driveUploadNeedsSignIn(): boolean {
  return !wgwHasAuthenticatedSession();
}

/** `auth`: only the files that failed on sign-in; `all`: *Retry all failed*. */
export type DriveUploadRetryAfterSignIn = "auth" | "all";

export function signInThenRetryDriveUploads(
  scope: DriveUploadRetryAfterSignIn,
  assign: (href: string) => void = (href) => window.location.assign(href),
): void {
  try {
    window.sessionStorage.setItem(RETRY_AFTER_SIGN_IN_KEY, scope);
  } catch {
    // Without session storage the user retries by hand after signing in.
  }
  assign(buildWgwLoginHref(UPLOADS_PATH));
}

/** The retry a sign-in was started for, once; clears the request. */
export function takeDriveUploadRetryAfterSignIn(): DriveUploadRetryAfterSignIn | null {
  try {
    const requested = window.sessionStorage.getItem(RETRY_AFTER_SIGN_IN_KEY);
    if (requested !== null) window.sessionStorage.removeItem(RETRY_AFTER_SIGN_IN_KEY);
    return requested === "auth" || requested === "all" ? requested : null;
  } catch {
    return null;
  }
}
