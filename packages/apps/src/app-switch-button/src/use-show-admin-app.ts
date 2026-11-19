import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { fetchWeGotWorkspaceHomeState } from "@/wegotworkspace/src/wegotworkspace-home-state";

/**
 * Last answer in this page load. Every app mounts its own sidebar, so without it
 * the app rail's Admin tile vanished and came back on each app switch.
 */
let lastKnownShowAdmin: boolean | null = null;

/** Drop the remembered answer (sign-out: it was the previous account's). */
export function forgetShowAdminApp(): void {
  lastKnownShowAdmin = null;
}

/**
 * Whether the Admin app should appear in chrome (home grid + app switch).
 * Reuses {@link fetchWeGotWorkspaceHomeState}'s `showAdmin` (the admin role, `isAdmin`).
 * Live API: fail closed until the first fetch resolves, then start from the last
 * answer and re-check; mock mode: visible immediately.
 */
export function useShowAdminApp(): boolean {
  // Mock mode stays "visible at once"; only the live check starts from the last answer.
  const [showAdmin, setShowAdmin] = useState(() =>
    wgwLiveApiEnabled() ? (lastKnownShowAdmin ?? false) : true,
  );

  useEffect(() => {
    let cancelled = false;
    void fetchWeGotWorkspaceHomeState().then((state) => {
      lastKnownShowAdmin = state.showAdmin;
      if (!cancelled) setShowAdmin(state.showAdmin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return showAdmin;
}
