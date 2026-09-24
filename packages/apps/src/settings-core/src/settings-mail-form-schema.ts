import type { SettingsMailRequest } from "@wgw/openapi-types/settings-types";
import { settingsMailRequestOpenapiSchema } from "@wgw/openapi-types/settings-request-zod";
import { z } from "zod";

/**
 * IMAP credentials editor. Wire body is checked with
 * {@link settingsMailRequestOpenapiSchema} in {@link settingsMailFormToRequest}.
 */
export const settingsMailFormSchema = z.object({
  imapUsername: z.string().trim().min(1, "Username is required"),
  imapPassword: z.string(),
});

export type SettingsMailFormValues = z.infer<typeof settingsMailFormSchema>;

export function settingsMailFormToRequest(values: SettingsMailFormValues): SettingsMailRequest {
  return settingsMailRequestOpenapiSchema.parse({
    imapUsername: values.imapUsername.trim(),
    imapPassword: values.imapPassword,
  }) as SettingsMailRequest;
}
