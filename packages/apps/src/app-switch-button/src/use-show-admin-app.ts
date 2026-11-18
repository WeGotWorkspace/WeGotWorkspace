import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { fetchWeGotWorkspaceHomeState } from "@/wegotworkspace/src/wegotworkspace-home-state";

/**
 * Last answer in this page load. Every app mounts its own sidebar, so without it
 * the app rail's Admin tile vanished and came back on each app switch.
 */
let lastKnownShowAdmin: boolean | null = null;

/**
 * Whether the Admin app should appear in chrome (home grid + app switch).
 * Reuses {@link fetchWeGotWorkspaceHomeState}'s `showAdmin` (the admin role, `isAdmin`).
 * Live API: fail closed until the first fetch resolves, then start from the last
 * answer and re-check; mock mode: visible immediately.
 */
export function useShowAdminApp(): boolean {
  const [showAdmin, setShowAdmin] = useState(() => lastKnownShowAdmin ?? !wgwLiveApiEnabled());

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
