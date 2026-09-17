import { useCallback, useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import type { SettingsSection } from "@/settings-core/src/settings-types";
import {
  isSettingsPathname,
  resolveSettingsSection,
  settingsNavigateTarget,
  settingsPathFor,
  settingsSectionFromLocation,
} from "@/settings-core/src/settings-section";

function navigateSettings(
  router: ReturnType<typeof useRouter>,
  section: SettingsSection,
  replace: boolean,
): void {
  void router.navigate({ ...settingsNavigateTarget(section), replace }).then(() => {
    router.history.flush?.();
  });
}

/**
 * Sync Settings section with `/settings` and `/settings/:section`.
 * Pass `mcpEnabled: null` until bootstrap is ready so a loading placeholder
 * cannot redirect `/settings/assistants` away before the kill-switch is known.
 */
export function useSettingsRouteSync(mcpEnabled: boolean | null): {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
} {
  const router = useRouter();
  const location = useLocation();
  const requested = settingsSectionFromLocation(location.pathname);
  const section = mcpEnabled === null ? requested : resolveSettingsSection(requested, mcpEnabled);

  useEffect(() => {
    if (mcpEnabled === null) return;
    const livePath = router.state.location.pathname;
    if (!isSettingsPathname(livePath)) return;
    const target = settingsPathFor(section);
    if (livePath === target) return;
    navigateSettings(router, section, true);
  }, [location.pathname, mcpEnabled, router, section]);

  const onSectionChange = useCallback(
    (next: SettingsSection) => {
      if (mcpEnabled === null) return;
      const livePath = router.state.location.pathname;
      if (!isSettingsPathname(livePath)) return;
      const resolved = resolveSettingsSection(next, mcpEnabled);
      const target = settingsPathFor(resolved);
      if (livePath === target) return;
      // Push so Back/Forward moves between Settings sections.
      navigateSettings(router, resolved, false);
    },
    [mcpEnabled, router],
  );

  return { section, onSectionChange };
}
