import { Card } from "@/card/src/card";
import { formatMailTransportSecurityLabel } from "@/settings-core/src/settings-mail-display";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import type { SettingsControllerState } from "@/settings-core/src/use-settings-controller";
import { Form } from "@/ui/form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { FormTextField } from "@/ui/form-text-field";
import { Input } from "@/ui/input";

export type SettingsMailPaneProps = {
  mail: SettingsControllerState["mail"];
};

export function SettingsMailPane({ mail }: SettingsMailPaneProps) {
  const { form, saveMail, imapHasPassword, server, savedImapUsername } = mail;
  const imapUsernameWatch = form.watch("imapUsername");
  const imapPasswordWatch = form.watch("imapPassword");

  const credentialsDirty =
    imapPasswordWatch.length > 0 || imapUsernameWatch.trim() !== savedImapUsername.trim();

  return (
    <>
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
            label="Password"
            variant="password"
            placeholder={imapHasPassword ? "••••••••" : "Enter password"}
          />
          <FormSaveActionRow
            className={settingsWorkspacePaneClasses.saveActionRow}
            label="Save changes"
            disabled={!credentialsDirty}
            onSave={saveMail}
          />
        </Card>
      </Form>

      <Card title="IMAP (incoming)">
        <FieldLabelRow label="Server" readOnly>
          <Input value={server.imapHost} readOnly />
        </FieldLabelRow>
        <div className={settingsWorkspacePaneClasses.grid2}>
          <FieldLabelRow label="Port" readOnly>
            <Input value={server.imapPort} readOnly />
          </FieldLabelRow>
          <FieldLabelRow label="Security" readOnly>
            <Input value={formatMailTransportSecurityLabel(server.imapSecurity)} readOnly />
          </FieldLabelRow>
        </div>
      </Card>

      <Card title="SMTP (outgoing)">
        <FieldLabelRow label="Server" readOnly>
          <Input value={server.smtpHost} readOnly />
        </FieldLabelRow>
        <div className={settingsWorkspacePaneClasses.grid2}>
          <FieldLabelRow label="Port" readOnly>
            <Input value={server.smtpPort} readOnly />
          </FieldLabelRow>
          <FieldLabelRow label="Security" readOnly>
            <Input value={formatMailTransportSecurityLabel(server.smtpSecurity)} readOnly />
          </FieldLabelRow>
        </div>
      </Card>
    </>
  );
}
