import type { SettingsMailRequest } from "@wgw-api-generated/settings-types";
import { settingsMailRequestOpenapiSchema } from "@wgw-api-generated/settings-request-zod";
import { z } from "zod";

const mailSecurity = z.enum(["ssl", "starttls", "none"]);

/**
 * Per-user IMAP + SMTP mailbox account. Wire body is checked with
 * {@link settingsMailRequestOpenapiSchema} in {@link settingsMailFormToRequest}.
 */
export const settingsMailFormSchema = z.object({
  imapUsername: z.string().trim().min(1, "Username is required"),
  imapPassword: z.string(),
  imapHost: z.string(),
  imapPort: z.string(),
  imapSecurity: mailSecurity,
  smtpHost: z.string(),
  smtpPort: z.string(),
  smtpSecurity: mailSecurity,
  smtpUsername: z.string(),
  smtpPassword: z.string(),
});

export type SettingsMailFormValues = z.infer<typeof settingsMailFormSchema>;

function parsePort(raw: string, fallback: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : fallback;
}

export function settingsMailFormToRequest(values: SettingsMailFormValues): SettingsMailRequest {
  const body: Record<string, unknown> = {
    imapUsername: values.imapUsername.trim(),
    imapPassword: values.imapPassword,
    imapHost: values.imapHost.trim(),
    imapPort: parsePort(values.imapPort, 993),
    imapSecurity: values.imapSecurity,
    smtpHost: values.smtpHost.trim(),
    smtpPort: parsePort(values.smtpPort, 587),
    smtpSecurity: values.smtpSecurity,
    smtpUsername: values.smtpUsername.trim(),
  };
  if (values.smtpPassword.trim() !== "") {
    body.smtpPassword = values.smtpPassword;
  }
  return settingsMailRequestOpenapiSchema.parse(body) as SettingsMailRequest;
}
