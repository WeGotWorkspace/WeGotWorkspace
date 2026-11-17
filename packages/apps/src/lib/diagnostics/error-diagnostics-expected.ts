import { isApiError } from "@/lib/api/api-error";
import { WgwGuestSessionMissingError } from "@/lib/api/wgw/guest-session-missing-error";
import { WgwSignInRequiredError } from "@/lib/api/wgw/sign-in-required-error";
import { JmapRequestError } from "@/lib/jmap-client/core/errors";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { isOfflineNotCachedError } from "@/lib/offline/core/offline-not-cached-error";

/**
 * Failures the code already expects and the UI already explains: an HTTP failure
 * with a status (`ApiError`, including 401/403 and session renewal), a missing
 * sign-in or guest session, a JMAP transport failure, being offline (a fetch that
 * never reached the server, an app with no offline copy yet), and a cancelled
 * request. Copy diagnostics keeps only the rest: errors nobody planned for.
 */
export function isExpectedFailure(error: unknown): boolean {
  if (isApiError(error)) return true;
  if (error instanceof WgwSignInRequiredError) return true;
  if (error instanceof WgwGuestSessionMissingError) return true;
  if (error instanceof JmapRequestError) return true;
  if (isOfflineNotCachedError(error)) return true;
  if (isFetchNetworkError(error)) return true;
  return error instanceof DOMException && error.name === "AbortError";
}
