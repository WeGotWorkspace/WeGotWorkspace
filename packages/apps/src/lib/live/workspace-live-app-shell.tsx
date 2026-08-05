import { useEffect } from "react";
import type { ReactElement } from "react";
import {
  clearWgwSession,
  wgwIsGuestSession,
  wgwRedirectGuestShareReauth,
} from "@/lib/api/wgw/http";
import {
  buildWgwLoginHref,
  isWgwAuthRoutePathname,
  sanitizeWgwReturnPath,
} from "@/lib/api/wgw/route-guard";
import { LiveBootstrapErrorPanel } from "@/lib/live/live-bootstrap-error-panel";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";

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
  const isDefinitiveAuthError =
    normalized.includes("(401)") ||
    normalized.includes("(403)") ||
    normalized.includes("invalid refresh token") ||
    normalized.includes("missing auth session") ||
    normalized.includes("missing or invalid bearer token");
  const isGuestShareAccessError =
    wgwIsGuestSession() &&
    (isDefinitiveAuthError ||
      normalized.includes("access denied") ||
      normalized.includes("(400)") ||
      normalized.includes("share session") ||
      normalized.includes("open the link again"));

  useEffect(() => {
    if (phase !== "error" || typeof window === "undefined") return;
    if (isGuestShareAccessError && wgwRedirectGuestShareReauth()) {
      return;
    }
    if (!isDefinitiveAuthError) return;
    // Storybook and local Vite dev: stay on the page and show the error panel instead of a blank
    // iframe / broken `/login` navigation. Production keeps the redirect to the real login route.
    if (import.meta.env.DEV) return;
    if (isWgwAuthRoutePathname(window.location.pathname)) return;
    clearWgwSession("401_online");
    const returnPath = sanitizeWgwReturnPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    window.location.assign(buildWgwLoginHref(returnPath));
  }, [isDefinitiveAuthError, isGuestShareAccessError, phase]);

  if (phase === "error") {
    if (isGuestShareAccessError) {
      return null;
    }
    if (isDefinitiveAuthError && !import.meta.env.DEV) {
      return null;
    }
    return <LiveBootstrapErrorPanel title={errorTitle} error={message || null} onRetry={retry} />;
  }

  if (phase === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <LoadingSpinner size="lg" label="Loading workspace…" />
      </div>
    );
  }

  return render(successVersion);
}
