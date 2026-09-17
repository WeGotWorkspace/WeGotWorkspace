import { Card } from "@/card/src/card";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { Form } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { FormTextField } from "@/ui/form-text-field";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SECURITY_OPTIONS } from "@/admin-core/src/admin-workspace-utils";
import { useFormContext } from "react-hook-form";
import type { SettingsMailFormValues } from "@/settings-core/src/settings-mail-form-schema";

export type SettingsMailPaneProps = {
  mail: SettingsControllerState["mail"];
};

function MailSecuritySelect({
  name,
  label,
}: {
  name: "imapSecurity" | "smtpSecurity";
  label: string;
}) {
  const form = useFormContext<SettingsMailFormValues>();
  const value = form.watch(name);
  return (
    <FieldLabelRow label={label}>
      <Select
        value={value}
        onValueChange={(next) =>
          form.setValue(name, next as SettingsMailFormValues[typeof name], { shouldDirty: true })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SECURITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}

export function SettingsMailPane({ mail }: SettingsMailPaneProps) {
  const { form, saveMail, imapHasPassword, smtpPasswordSet, savedImapUsername, savedSmtpUsername } =
    mail;
  const watched = form.watch();
  const credentialsDirty =
    watched.imapPassword.length > 0 ||
    watched.smtpPassword.length > 0 ||
    watched.imapUsername.trim() !== savedImapUsername.trim() ||
    watched.smtpUsername.trim() !== savedSmtpUsername.trim() ||
    watched.imapHost.trim() !== mail.server.imapHost.trim() ||
    watched.smtpHost.trim() !== mail.server.smtpHost.trim() ||
    watched.imapPort.trim() !== String(mail.server.imapPort || 993) ||
    watched.smtpPort.trim() !== String(mail.server.smtpPort || 587) ||
    watched.imapSecurity !==
      mail.server.imapSecurity.trim().toLowerCase().replace("ssl/tls", "ssl") ||
    watched.smtpSecurity !==
      mail.server.smtpSecurity.trim().toLowerCase().replace("ssl/tls", "ssl");

  return (
    <Form {...form}>
      <Card title="Credentials">
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="imapUsername"
          label="Username (IMAP/SMTP login)"
          type="email"
          placeholder="mailbox@example.com"
        />
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="imapPassword"
          label="IMAP password"
          type="password"
          placeholder={imapHasPassword ? "••••••••" : "Enter password"}
        />
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="smtpUsername"
          label="SMTP username (optional)"
          placeholder="Leave empty to reuse IMAP login"
        />
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="smtpPassword"
          label="SMTP password (optional)"
          type="password"
          placeholder={smtpPasswordSet ? "••••••••" : "Leave empty to reuse IMAP password"}
        />
      </Card>

      <Card title="IMAP (incoming)">
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="imapHost"
          label="Server"
          placeholder="imap.example.com"
        />
        <div className={settingsWorkspacePaneClasses.grid2}>
          <FormTextField
            {...settingsWorkspacePaneClasses.formTextField}
            name="imapPort"
            label="Port"
            type="number"
          />
          <MailSecuritySelect name="imapSecurity" label="Security" />
        </div>
      </Card>

      <Card title="SMTP (outgoing)">
        <FormTextField
          {...settingsWorkspacePaneClasses.formTextField}
          name="smtpHost"
          label="Server"
          placeholder="smtp.example.com"
        />
        <div className={settingsWorkspacePaneClasses.grid2}>
          <FormTextField
            {...settingsWorkspacePaneClasses.formTextField}
            name="smtpPort"
            label="Port"
            type="number"
          />
          <MailSecuritySelect name="smtpSecurity" label="Security" />
        </div>
      </Card>

      <FormSaveActionRow
        className={settingsWorkspacePaneClasses.saveActionRow}
        label="Save changes"
        disabled={!credentialsDirty}
        onSave={saveMail}
      />
    </Form>
  );
}
