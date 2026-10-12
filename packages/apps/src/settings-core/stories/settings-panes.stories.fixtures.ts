import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import type { SettingsGroup } from "@/settings-core/src/settings-types";
import type { SettingsMailFormValues } from "@/settings-core/src/settings-mail-form-schema";
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

export function getMailFormDefaults(
  overrides: Partial<SettingsMailFormValues> = {},
): SettingsMailFormValues {
  const { data } = createSettingsAppBootstrap();
  return {
    imapUsername: data.mail.imapUsername || data.user.email,
    imapPassword: "",
    ...overrides,
  };
}

export function getMailStoryMeta(overrides: { imapHasPassword?: boolean } = {}) {
  const { data } = createSettingsAppBootstrap();
  return {
    server: data.mailServer,
    imapHasPassword: overrides.imapHasPassword ?? data.mail.imapHasPassword,
    savedImapUsername: data.mail.imapUsername,
  };
}

export function createMockGroups(overrides?: SettingsGroup[]): SettingsGroup[] {
  return overrides ?? createSettingsAppBootstrap().data.groups;
}
