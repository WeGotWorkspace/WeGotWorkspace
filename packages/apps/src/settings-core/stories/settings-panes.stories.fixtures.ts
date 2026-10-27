import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import type { SettingsGroup } from "@/settings-core/src/settings-types";
import type { SettingsProfileFormValues } from "@/settings-core/src/settings-profile-form-schema";

export function getProfileFormDefaults(
  overrides: Partial<SettingsProfileFormValues> = {},
): SettingsProfileFormValues {
  const { data } = createSettingsAppBootstrap();
  return {
    displayName: data.user.displayName,
    email: data.user.email,
    newPassword: "",
    confirmPassword: "",
    currentPassword: "",
    ...overrides,
  };
}

export function getProfileStoryUsername(): string {
  return createSettingsAppBootstrap().data.user.username;
}

export function createMockGroups(overrides?: SettingsGroup[]): SettingsGroup[] {
  return overrides ?? createSettingsAppBootstrap().data.groups;
}
