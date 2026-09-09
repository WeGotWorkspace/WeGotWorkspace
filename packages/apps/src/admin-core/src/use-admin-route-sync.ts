import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import type { AdminSection } from "@/admin-core/src/admin-types";
import { adminPathFor, isAdminPathname, resolveAdminSection } from "@/admin-core/src/admin-section";

type AdminRouteParams = {
  section?: string;
};

/**
 * Sync Admin section with `/admin` and `/admin/:section`.
 * Canonicalize unknown paths with replace; push on sidebar selection so
 * browser back/forward moves between panes.
 */
export function useAdminRouteSync(): {
  section: AdminSection;
  onSectionChange: (section: AdminSection) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false }) as AdminRouteParams;
  const section = resolveAdminSection(params.section);

  useEffect(() => {
    if (!isAdminPathname(location.pathname)) return;
    const target = adminPathFor(section);
    if (location.pathname === target) return;
    void navigate({ to: target, replace: true });
  }, [location.pathname, navigate, section]);

  const onSectionChange = useCallback(
    (next: AdminSection) => {
      const resolved = resolveAdminSection(next);
      const target = adminPathFor(resolved);
      if (!isAdminPathname(location.pathname) || location.pathname === target) return;
      void navigate({ to: target });
    },
    [location.pathname, navigate],
  );

  return { section, onSectionChange };
}
