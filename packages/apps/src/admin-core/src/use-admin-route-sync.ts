import { useCallback, useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import type { AdminSection } from "@/admin-core/src/admin-types";
import {
  adminNavigateTarget,
  adminPathFor,
  adminSectionFromPathname,
  isAdminPathname,
  resolveAdminSection,
} from "@/admin-core/src/admin-section";

/**
 * Sync Admin section with `/admin` and `/admin/:section`.
 * Section is read from the pathname (not `useParams`) so a still-mounted
 * `/admin` route cannot canonicalize `/admin/mail` back to `/admin`.
 */
export function useAdminRouteSync(): {
  section: AdminSection;
  onSectionChange: (section: AdminSection) => void;
} {
  const router = useRouter();
  const location = useLocation();
  const section = resolveAdminSection(adminSectionFromPathname(location.pathname));

  useEffect(() => {
    const path = router.state.location.pathname;
    if (!isAdminPathname(path)) return;
    const resolved = resolveAdminSection(adminSectionFromPathname(path));
    const target = adminPathFor(resolved);
    if (path === target) return;
    void router.navigate({ ...adminNavigateTarget(resolved), replace: true }).then(() => {
      router.history.flush?.();
    });
  }, [location.pathname, router]);

  const onSectionChange = useCallback(
    (next: AdminSection) => {
      const path = router.state.location.pathname;
      const resolved = resolveAdminSection(next);
      const target = adminPathFor(resolved);
      if (!isAdminPathname(path) || path === target) return;
      void router.navigate(adminNavigateTarget(resolved)).then(() => {
        router.history.flush?.();
      });
    },
    [router],
  );

  return { section, onSectionChange };
}
