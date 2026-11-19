import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
  wgwRedirectGuestShareReauth,
} from "@/lib/api/wgw/http";
import {
  buildWgwLoginHref,
  isWgwAuthRoutePathname,
  isWgwSignedOutRoutePathname,
  sanitizeWgwReturnPath,
} from "@/lib/api/wgw/route-guard";
import { WgwSignInRequiredError } from "@/lib/api/wgw/sign-in-required-error";
import { LiveBootstrapErrorPanel } from "@/lib/live/live-bootstrap-error-panel";
import { OfflineNotCachedPanel } from "@/lib/live/offline-not-cached-panel";
import { isOfflineNotCachedError } from "@/lib/offline/core/offline-not-cached-error";

function isSignInRequiredError(error: unknown, normalizedMessage: string): boolean {
  if (error instanceof WgwSignInRequiredError) return true;
  return normalizedMessage.includes("missing auth session");
}

type WorkspaceLiveAppShellProps = {
  phase: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  errorTitle: string;
  successVersion: number;
  render: (successVersion: number) => ReactElement;
};

export function WorkspaceLiveAppShell({
  phase,
  error,
  retry,
  errorTitle,
  successVersion,
  render,
}: WorkspaceLiveAppShellProps) {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  // `http.ts` alone decides sign-out: it clears the stored session when the server rejects
  // the refresh. A bootstrap error with a stored session is transient or a permission
  // failure, and must not sign every installed PWA out. Two cases go to /login:
  // - a member session this page had, and lost;
  // - no session at all and the app says sign-in is required (an installed app
  //   launched signed out, e.g. a fresh PWA with its own storage).
  // Guest doors (/share, Meet lobby/join/invites) and /install load without a member
  // session on purpose, and a page that started as a guest returns to /share instead.
  // Lazy: read storage once at mount, not on every render.
  const [mountSession] = useState(() => {
    const signedIn = wgwHasAuthenticatedSession();
    const guest = signedIn && wgwIsGuestSession();
    return { member: signedIn && !guest, guest };
  });
  const hadMemberSession = mountSession.member;
  const isSessionGone = phase === "error" && hadMemberSession && !wgwHasAuthenticatedSession();
  const isSignedOutLaunch =
    phase === "error" &&
    !mountSession.guest &&
    !wgwHasAuthenticatedSession() &&
    isSignInRequiredError(error, normalized) &&
    typeof window !== "undefined" &&
    !isWgwSignedOutRoutePathname(window.location.pathname);
  const needsLogin = isSessionGone || isSignedOutLaunch;
  const isGuestShareAccessError =
    phase === "error" &&
    wgwIsGuestSession() &&
    (normalized.includes("(401)") ||
      normalized.includes("(403)") ||
      normalized.includes("missing or invalid bearer token") ||
      normalized.includes("access denied") ||
      normalized.includes("(400)") ||
      normalized.includes("share session") ||
      normalized.includes("open the link again"));

  useEffect(() => {
    if (phase !== "error" || typeof window === "undefined") return;
    if (isGuestShareAccessError) {
      if (wgwRedirectGuestShareReauth()) return;
      // No share token to return to: the reauth cleared the guest, so login is the way back.
    } else if (!needsLogin) {
      return;
    }
    // Storybook and local Vite dev: stay on the page and show the error panel instead of a blank
    // iframe / broken `/login` navigation. Production keeps the redirect to the real login route.
    if (import.meta.env.DEV) return;
    if (isWgwAuthRoutePathname(window.location.pathname)) return;
    const returnPath = sanitizeWgwReturnPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    window.location.assign(buildWgwLoginHref(returnPath));
  }, [isGuestShareAccessError, needsLogin, phase]);

  if (phase === "error") {
    if (isGuestShareAccessError) {
      return null;
    }
    if (needsLogin && !import.meta.env.DEV) {
      return null;
    }
    if (isOfflineNotCachedError(error)) {
      return <OfflineNotCachedPanel onRetry={retry} />;
    }
    return <LiveBootstrapErrorPanel title={errorTitle} error={message || null} onRetry={retry} />;
  }

  // Offline-first: mount workspace chrome immediately while hybrid bootstrap / sync runs.
  // Apps already expose placeholder data + `listLoading` for in-pane pending state.
  return render(successVersion);
}
