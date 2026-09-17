import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import {
  settingsMailFormSchema,
  settingsMailFormToRequest,
  type SettingsMailFormValues,
} from "@/settings-core/src/settings-mail-form-schema";
import type {
  SettingsAPIOperations,
  SettingsMailCredentials,
  SettingsMailServer,
} from "@/settings-core/src/settings-types";

function securityToken(raw: string, fallback: "ssl" | "starttls"): "ssl" | "starttls" | "none" {
  const n = raw.trim().toLowerCase();
  if (n === "ssl" || n === "ssl/tls") return "ssl";
  if (n === "starttls") return "starttls";
  if (n === "none") return "none";
  return fallback;
}

function formValuesFromSaved(
  profileEmail: string,
  mail: SettingsMailCredentials,
  mailServer: SettingsMailServer,
): SettingsMailFormValues {
  return {
    imapUsername: mail.imapUsername.trim() || profileEmail.trim(),
    imapPassword: "",
    imapHost: mailServer.imapHost,
    imapPort: String(mailServer.imapPort || 993),
    imapSecurity: securityToken(mailServer.imapSecurity, "ssl"),
    smtpHost: mailServer.smtpHost,
    smtpPort: String(mailServer.smtpPort || 587),
    smtpSecurity: securityToken(mailServer.smtpSecurity, "starttls"),
    smtpUsername: mail.smtpUsername,
    smtpPassword: "",
  };
}

export function useSettingsMailForm({
  profileEmail,
  mail,
  mailServer,
  operations,
}: {
  profileEmail: string;
  mail: SettingsMailCredentials;
  mailServer: SettingsMailServer;
  operations?: SettingsAPIOperations;
}) {
  const runWithAppToast = useRunWithAppToast();
  const mailForm = useForm<SettingsMailFormValues>({
    resolver: zodResolver(settingsMailFormSchema),
    defaultValues: formValuesFromSaved(profileEmail, mail, mailServer),
    mode: "onSubmit",
  });

  const { reset } = mailForm;

  useEffect(() => {
    reset(formValuesFromSaved(profileEmail, mail, mailServer));
  }, [
    mail.imapUsername,
    mail.smtpUsername,
    mailServer.imapHost,
    mailServer.imapPort,
    mailServer.imapSecurity,
    mailServer.smtpHost,
    mailServer.smtpPort,
    mailServer.smtpSecurity,
    profileEmail,
    reset,
  ]);

  const saveMail = mailForm.handleSubmit(async (values) => {
    const requestBody = settingsMailFormToRequest(values);
    await runWithAppToast(
      async () => {
        await operations?.saveMail(requestBody);
        reset({
          ...values,
          imapPassword: "",
          smtpPassword: "",
        });
      },
      {
        success: "Mail account saved",
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) =>
          error instanceof Error ? error.message : "Could not save mail account",
      },
    );
  });

  return {
    form: mailForm,
    saveMail,
    imapHasPassword: mail.imapHasPassword,
    smtpPasswordSet: mail.smtpPasswordSet,
    server: mailServer,
    savedImapUsername: mail.imapUsername,
    savedSmtpUsername: mail.smtpUsername,
  };
}

export type SettingsMailFormController = ReturnType<typeof useSettingsMailForm>;
