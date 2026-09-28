import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SECURITY_OPTIONS } from "@/admin-core/src/admin-workspace-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminMailPaneProps = {
  controller: AdminControllerState;
};

export function AdminMailPane({ controller }: AdminMailPaneProps) {
  return (
    <>
      <Callout
        severity="info"
        title="For a later release"
        message="These IMAP and SMTP hosts are for the Mail client. This release does not open a mailbox."
      />
      <Card title="IMAP (incoming)">
        <FormField htmlFor="admin-mail-imap-host" label="Server">
          <Input
            id="admin-mail-imap-host"
            value={controller.settingsForm.imapHost}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                imapHost: value,
              }));
            }}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField htmlFor="admin-mail-imap-port" label="Port">
            <Input
              id="admin-mail-imap-port"
              type="number"
              value={String(controller.settingsForm.imapPort)}
              onChange={(event) => {
                const value = Number(event.target.value) || 0;
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  imapPort: value,
                }));
              }}
            />
          </FormField>
          <FormField htmlFor="admin-mail-imap-security" label="Security">
            <Select
              value={controller.settingsForm.imapSecurity || "ssl"}
              onValueChange={(value) =>
                controller.setSettingsForm((prev) => ({ ...prev, imapSecurity: value }))
              }
            >
              <SelectTrigger id="admin-mail-imap-security" aria-label="Security">
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
          </FormField>
        </div>
      </Card>
      <Card title="SMTP (outgoing)">
        <FormField htmlFor="admin-mail-smtp-host" label="Server">
          <Input
            id="admin-mail-smtp-host"
            value={controller.settingsForm.smtpHost}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                smtpHost: value,
              }));
            }}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField htmlFor="admin-mail-smtp-port" label="Port">
            <Input
              id="admin-mail-smtp-port"
              type="number"
              value={String(controller.settingsForm.smtpPort)}
              onChange={(event) => {
                const value = Number(event.target.value) || 0;
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  smtpPort: value,
                }));
              }}
            />
          </FormField>
          <FormField htmlFor="admin-mail-smtp-security" label="Security">
            <Select
              value={controller.settingsForm.smtpSecurity || "ssl"}
              onValueChange={(value) =>
                controller.setSettingsForm((prev) => ({ ...prev, smtpSecurity: value }))
              }
            >
              <SelectTrigger id="admin-mail-smtp-security" aria-label="Security">
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
          </FormField>
        </div>
      </Card>
      <div className="flex justify-end">
        <Button
          label="Save changes"
          variant="primary"
          onClick={() => void controller.actions.saveSettings()}
        />
      </div>
    </>
  );
}
