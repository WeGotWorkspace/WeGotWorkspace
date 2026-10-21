import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import {
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
  wgwRedirectGuestShareReauth,
} from "@/lib/api/wgw/http";
import {
  buildWgwLoginHref,
  isWgwAuthRoutePathname,
  sanitizeWgwReturnPath,
} from "@/lib/api/wgw/route-guard";
import { LiveBootstrapErrorPanel } from "@/lib/live/live-bootstrap-error-panel";

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
  // failure, and must not sign every installed PWA out. Only a member session this page
  // had, and lost, redirects: /install loads without one, and a guest returns to /share.
  const hadMemberSessionRef = useRef(wgwHasAuthenticatedSession() && !wgwIsGuestSession());
  const isSessionGone =
    phase === "error" && hadMemberSessionRef.current && !wgwHasAuthenticatedSession();
  const isGuestShareAccessError =
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
    } else if (!hadMemberSessionRef.current || wgwHasAuthenticatedSession()) {
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
  }, [isGuestShareAccessError, isSessionGone, phase]);

  if (phase === "error") {
    if (isGuestShareAccessError) {
      return null;
    }
    if (isSessionGone && !import.meta.env.DEV) {
      return null;
    }
    return <LiveBootstrapErrorPanel title={errorTitle} error={message || null} onRetry={retry} />;
  }

  // Offline-first: mount workspace chrome immediately while hybrid bootstrap / sync runs.
  // Apps already expose placeholder data + `listLoading` for in-pane pending state.
  return render(successVersion);
}
