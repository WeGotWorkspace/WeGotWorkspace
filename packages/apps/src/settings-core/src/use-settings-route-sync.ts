import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import type { SettingsSection } from "@/settings-core/src/settings-types";
import {
  isSettingsPathname,
  isSettingsSection,
  resolveSettingsSection,
  SETTINGS_DEFAULT_SECTION,
  settingsPathFor,
} from "@/settings-core/src/settings-section";

type SettingsRouteParams = {
  section?: string;
};

/**
 * Sync Settings section with `/settings` and `/settings/:section`.
 * Pass `mcpEnabled: null` until bootstrap is ready so a loading placeholder
 * cannot redirect `/settings/assistants` away before the kill-switch is known.
 */
export function useSettingsRouteSync(mcpEnabled: boolean | null): {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false }) as SettingsRouteParams;
  const requested = isSettingsSection(params.section) ? params.section : SETTINGS_DEFAULT_SECTION;
  const section = mcpEnabled === null ? requested : resolveSettingsSection(requested, mcpEnabled);

  useEffect(() => {
    if (mcpEnabled === null || !isSettingsPathname(location.pathname)) return;
    const target = settingsPathFor(section);
    if (location.pathname === target) return;
    void navigate({ to: target, replace: true });
  }, [location.pathname, mcpEnabled, navigate, section]);

  const onSectionChange = useCallback(
    (next: SettingsSection) => {
      if (mcpEnabled === null) return;
      const resolved = resolveSettingsSection(next, mcpEnabled);
      const target = settingsPathFor(resolved);
      if (!isSettingsPathname(location.pathname) || location.pathname === target) return;
      void navigate({ to: target, replace: true });
    },
    [location.pathname, mcpEnabled, navigate],
  );

  return { section, onSectionChange };
}
