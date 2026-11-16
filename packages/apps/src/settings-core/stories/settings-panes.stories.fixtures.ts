import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import type { SettingsGroup, SettingsUser } from "@/lib/models/settings-types";

/** The signed-in user the Profile stories show. */
export function getProfileStoryUser(): SettingsUser {
  return createSettingsAppBootstrap().data.user;
}

export function createMockGroups(overrides?: SettingsGroup[]): SettingsGroup[] {
  return overrides ?? createSettingsAppBootstrap().data.groups;
}
