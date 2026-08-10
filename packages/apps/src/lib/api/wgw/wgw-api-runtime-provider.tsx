import { useEffect, useMemo, type ReactNode } from "react";
import { wgwEnsureSession } from "@/lib/api/wgw/http";
import { normalizeWgwApiBaseUrl, pushWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { startWgwSessionKeeper } from "@/lib/api/wgw/session-keeper";

type WgwApiRuntimeProviderProps = {
  /** REST API root (with or without trailing `/api/v1`). */
  apiBaseUrl: string;
  children: ReactNode;
};

/** Scope live API base URL and mode to a React subtree (Storybook, embedded shell, etc.). */
export function WgwApiRuntimeProvider({ apiBaseUrl, children }: WgwApiRuntimeProviderProps) {
  const normalizedBaseUrl = useMemo(() => normalizeWgwApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  useEffect(() => {
    return pushWgwApiRuntime({
      baseUrl: normalizedBaseUrl,
      useLiveApi: true,
    });
  }, [normalizedBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    let stopKeeper: (() => void) | undefined;
    void (async () => {
      try {
        await wgwEnsureSession();
      } catch {
        // No stored session and no dev auto-login — login route will handle sign-in.
      } finally {
        if (!cancelled) {
          stopKeeper = startWgwSessionKeeper();
        }
      }
    })();
    return () => {
      cancelled = true;
      stopKeeper?.();
    };
  }, [normalizedBaseUrl]);

  return children;
}
