import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { fetchWeGotWorkspaceHomeState } from "@/wegotworkspace/src/wegotworkspace-home-state";

/**
 * Whether the Admin app should appear in chrome (home grid + app switch).
 * Reuses {@link fetchWeGotWorkspaceHomeState}'s `showAdmin` (administrators group).
 * Live API: fail closed until the fetch resolves; mock mode: visible immediately.
 */
export function useShowAdminApp(): boolean {
  const [showAdmin, setShowAdmin] = useState(() => !wgwLiveApiEnabled());

  useEffect(() => {
    let cancelled = false;
    void fetchWeGotWorkspaceHomeState().then((state) => {
      if (!cancelled) setShowAdmin(state.showAdmin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return showAdmin;
}
