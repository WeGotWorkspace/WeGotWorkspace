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
    imapHost: data.mailServer.imapHost,
    imapPort: String(data.mailServer.imapPort),
    imapSecurity: "ssl",
    smtpHost: data.mailServer.smtpHost,
    smtpPort: String(data.mailServer.smtpPort),
    smtpSecurity: "ssl",
    smtpUsername: data.mail.smtpUsername,
    smtpPassword: "",
    ...overrides,
  };
}

export function getMailStoryMeta(
  overrides: { imapHasPassword?: boolean; smtpPasswordSet?: boolean } = {},
) {
  const { data } = createSettingsAppBootstrap();
  return {
    server: data.mailServer,
    imapHasPassword: overrides.imapHasPassword ?? data.mail.imapHasPassword,
    smtpPasswordSet: overrides.smtpPasswordSet ?? data.mail.smtpPasswordSet,
    savedImapUsername: data.mail.imapUsername,
    savedSmtpUsername: data.mail.smtpUsername,
  };
}

export function createMockGroups(overrides?: SettingsGroup[]): SettingsGroup[] {
  return overrides ?? createSettingsAppBootstrap().data.groups;
}
