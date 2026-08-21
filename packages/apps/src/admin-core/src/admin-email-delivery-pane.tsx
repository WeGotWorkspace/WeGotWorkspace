import { useState } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { lastTestSendLabel } from "@/admin-core/src/admin-mail-delivery";
import { MailDeliveryTestDialog } from "@/admin-core/src/admin-workspace-dialogs";
import { SECURITY_OPTIONS } from "@/admin-core/src/admin-workspace-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

const TRANSPORT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "smtp", label: "SMTP" },
  { value: "php", label: "PHP mail()" },
  { value: "sendmail", label: "Sendmail" },
] as const;

export type AdminEmailDeliveryPaneProps = {
  controller: AdminControllerState;
};

export function AdminEmailDeliveryPane({ controller }: AdminEmailDeliveryPaneProps) {
  const delivery = controller.mailDelivery;
  const capability = delivery.capability;
  const selected = capability.selectedTransport ?? "none";
  const [testSendOpen, setTestSendOpen] = useState(false);

  return (
    <div className="admin-email-delivery-pane">
      <Callout
        severity={capability.canSubmit ? "info" : "warning"}
        title={capability.canSubmit ? "Submission is possible" : "Cannot submit yet"}
        message={
          capability.canSubmit
            ? `Capability check passed. Selected transport: ${selected}. This is not a claim that mail will arrive in an inbox.`
            : "Configure a valid From address and a usable transport before the instance can submit outbound mail. Login hides “Forgot password?” until this check passes."
        }
      />
      <Callout
        severity={
          delivery.lastTestSend == null
            ? "info"
            : delivery.lastTestSend.accepted
              ? "success"
              : "error"
        }
        title="Last test send"
        message={lastTestSendLabel(delivery.lastTestSend)}
      />

      <Card title="From and transport">
        <p className="admin-email-delivery-pane__help">
          Platform email is separate from the Mail app IMAP/SMTP pane. Password recovery uses this
          From address and transport.
        </p>
        <FormField htmlFor="admin-mail-delivery-from" label="From address">
          <Input
            id="admin-mail-delivery-from"
            type="email"
            value={controller.settingsForm.mailDeliveryFrom}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                mailDeliveryFrom: value,
              }));
            }}
          />
        </FormField>
        <FormField htmlFor="admin-mail-delivery-transport" label="Transport">
          <Select
            value={controller.settingsForm.mailDeliveryTransport || "auto"}
            onValueChange={(value) =>
              controller.setSettingsForm((prev) => ({ ...prev, mailDeliveryTransport: value }))
            }
          >
            <SelectTrigger id="admin-mail-delivery-transport" aria-label="Transport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSPORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </Card>

      <Card title="SMTP (optional)">
        <p className="admin-email-delivery-pane__help">
          Auto uses SMTP only when a host is set and either a username is set or the relay does not
          require auth (for example local Postfix on localhost with security none).
        </p>
        <FormField htmlFor="admin-mail-delivery-smtp-host" label="SMTP host">
          <Input
            id="admin-mail-delivery-smtp-host"
            value={controller.settingsForm.mailDeliverySmtpHost}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                mailDeliverySmtpHost: value,
              }));
            }}
          />
        </FormField>
        <div className="admin-email-delivery-pane__row">
          <FormField htmlFor="admin-mail-delivery-smtp-port" label="Port">
            <Input
              id="admin-mail-delivery-smtp-port"
              type="number"
              value={String(controller.settingsForm.mailDeliverySmtpPort)}
              onChange={(event) => {
                const value = Number(event.target.value) || 0;
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  mailDeliverySmtpPort: value,
                }));
              }}
            />
          </FormField>
          <FormField htmlFor="admin-mail-delivery-smtp-security" label="Security">
            <Select
              value={controller.settingsForm.mailDeliverySmtpSecurity || "starttls"}
              onValueChange={(value) =>
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  mailDeliverySmtpSecurity: value,
                }))
              }
            >
              <SelectTrigger id="admin-mail-delivery-smtp-security" aria-label="Security">
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
        <FormField htmlFor="admin-mail-delivery-smtp-username" label="SMTP username">
          <Input
            id="admin-mail-delivery-smtp-username"
            value={controller.settingsForm.mailDeliverySmtpUsername}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                mailDeliverySmtpUsername: value,
              }));
            }}
          />
        </FormField>
        <FormField htmlFor="admin-mail-delivery-smtp-password" label="SMTP password">
          <Input
            id="admin-mail-delivery-smtp-password"
            type="password"
            autoComplete="new-password"
            value={controller.settingsForm.mailDeliverySmtpPassword}
            placeholder={
              delivery.config.smtpPasswordSet ? "Leave blank to keep the stored secret" : ""
            }
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                mailDeliverySmtpPassword: value,
              }));
            }}
          />
        </FormField>
        {delivery.config.smtpPasswordSet ? (
          <div className="admin-email-delivery-pane__actions">
            <Button
              label="Clear stored SMTP password"
              variant="subtle"
              onClick={() => void controller.actions.clearMailDeliverySmtpPassword()}
            />
          </div>
        ) : null}
      </Card>

      <div className="admin-email-delivery-pane__actions">
        <Button label="Save changes" variant="primary" onClick={controller.actions.saveSettings} />
        <Button
          label="Send test email"
          variant="subtle"
          disabled={!capability.canSubmit}
          onClick={() => setTestSendOpen(true)}
        />
      </div>
      <MailDeliveryTestDialog
        open={testSendOpen}
        onOpenChange={setTestSendOpen}
        onSubmit={async (to) => {
          if (await controller.actions.sendMailDeliveryTest(to)) {
            setTestSendOpen(false);
          }
        }}
      />
    </div>
  );
}
