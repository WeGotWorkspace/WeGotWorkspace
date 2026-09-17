import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Card } from "@/card/src/card";
import { FieldLabelRow } from "@/ui/field-label-row";
import type { InstallControllerState } from "@/install-core/src/use-install-controller";
import { InstallFeatureRow } from "@/install-core/src/install-workspace-widgets";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

function MailSecuritySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const options = ["none", "starttls", "ssl"];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => (
          <SelectItem key={item} value={item}>
            {item.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InstallMailPane({
  controller,
}: {
  controller: Pick<InstallControllerState, "mail" | "setMail">;
}) {
  const { mail, setMail } = controller;

  return (
    <>
      <Card title="Mail feature">
        <InstallFeatureRow
          label="Enable webmail"
          desc="Configure the installing admin’s mailbox now so Mail is ready after install."
          value={mail.enabled}
          onChange={(value) => setMail((current) => ({ ...current, enabled: value }))}
        />
      </Card>
      {mail.enabled ? (
        <>
          <Card title="IMAP (incoming)">
            <FieldLabelRow label="Server">
              <Input
                value={mail.imapHost}
                onChange={(event) =>
                  setMail((current) => ({ ...current, imapHost: event.target.value }))
                }
                placeholder="imap.example.com"
              />
            </FieldLabelRow>
            <div className={c.grid2}>
              <FieldLabelRow label="Port">
                <Input
                  value={mail.imapPort}
                  onChange={(event) =>
                    setMail((current) => ({ ...current, imapPort: event.target.value }))
                  }
                />
              </FieldLabelRow>
              <FieldLabelRow label="Security">
                <MailSecuritySelect
                  value={mail.imapSec}
                  onChange={(value) => setMail((current) => ({ ...current, imapSec: value }))}
                />
              </FieldLabelRow>
            </div>
            <FieldLabelRow label="IMAP username">
              <Input
                value={mail.imapUsername}
                onChange={(event) =>
                  setMail((current) => ({ ...current, imapUsername: event.target.value }))
                }
                placeholder="Defaults to the admin email"
              />
            </FieldLabelRow>
            <FieldLabelRow label="IMAP password">
              <Input
                type="password"
                value={mail.imapPassword}
                onChange={(event) =>
                  setMail((current) => ({ ...current, imapPassword: event.target.value }))
                }
                placeholder="Defaults to the admin password"
              />
            </FieldLabelRow>
          </Card>
          <Card title="SMTP (outgoing)">
            <FieldLabelRow label="Server">
              <Input
                value={mail.smtpHost}
                onChange={(event) =>
                  setMail((current) => ({ ...current, smtpHost: event.target.value }))
                }
                placeholder="smtp.example.com"
              />
            </FieldLabelRow>
            <div className={c.grid2}>
              <FieldLabelRow label="Port">
                <Input
                  value={mail.smtpPort}
                  onChange={(event) =>
                    setMail((current) => ({ ...current, smtpPort: event.target.value }))
                  }
                />
              </FieldLabelRow>
              <FieldLabelRow label="Security">
                <MailSecuritySelect
                  value={mail.smtpSec}
                  onChange={(value) => setMail((current) => ({ ...current, smtpSec: value }))}
                />
              </FieldLabelRow>
            </div>
            <FieldLabelRow label="SMTP username (optional)">
              <Input
                value={mail.smtpUsername}
                onChange={(event) =>
                  setMail((current) => ({ ...current, smtpUsername: event.target.value }))
                }
                placeholder="Leave empty to reuse IMAP login"
              />
            </FieldLabelRow>
            <FieldLabelRow label="SMTP password (optional)">
              <Input
                type="password"
                value={mail.smtpPassword}
                onChange={(event) =>
                  setMail((current) => ({ ...current, smtpPassword: event.target.value }))
                }
                placeholder="Leave empty to reuse IMAP password"
              />
            </FieldLabelRow>
          </Card>
        </>
      ) : null}
    </>
  );
}
