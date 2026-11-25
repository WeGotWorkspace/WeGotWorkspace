import { useState } from "react";
import { Mail, Send, Server } from "lucide-react";
import { Button } from "@/button/src/button";
import { Tag } from "@/tag/src/tag";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import {
  lastTestSendLabel,
  MAIL_DELIVERY_PLACEHOLDER_FROM,
} from "@/lib/models/admin-mail-delivery";
import { MailDeliveryTestDialog } from "@/admin-core/src/mail-delivery-test-dialog";
import { SECURITY_OPTIONS } from "@/admin-core/src/admin-workspace-utils";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
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
  const form = controller.settingsForm;
  const [testSendOpen, setTestSendOpen] = useState(false);
  const { choose, type, clear } = useAdminSettingsEditor();
  const lastTest = delivery.lastTestSend;
  const usesPlaceholderFrom = capability.canSubmit && !capability.probes.fromConfigured;

  return (
    <>
      <WorkspacePageSection title="Sending" icon={<Send aria-hidden />}>
        {capability.canSubmit ? null : (
          <FieldLabelRow
            layout="inline"
            label="Delivery"
            description="Choose a transport that works here. Until then, “Forgot password?” stays hidden."
          >
            <Tag label="Cannot send" tone="warning" dot />
          </FieldLabelRow>
        )}
        <FieldLabelRow
          layout="inline"
          fill
          label="From address"
          description={
            usesPlaceholderFrom
              ? `Empty: mail comes from ${MAIL_DELIVERY_PLACEHOLDER_FROM} and may land in spam.`
              : "Used for password resets and invitations."
          }
          htmlFor="admin-mail-delivery-from"
        >
          <Input
            id="admin-mail-delivery-from"
            type="email"
            placeholder={MAIL_DELIVERY_PLACEHOLDER_FROM}
            value={form.mailDeliveryFrom}
            onChange={(event) => type({ mailDeliveryFrom: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          label="Transport"
          description="Auto uses SMTP when a host is set."
          htmlFor="admin-mail-delivery-transport"
        >
          <Select
            value={form.mailDeliveryTransport || "auto"}
            onValueChange={(value) => choose({ mailDeliveryTransport: value })}
          >
            <CollectionGhostSelectTrigger
              id="admin-mail-delivery-transport"
              aria-label="Transport"
              label={<SelectValue />}
            />
            <SelectContent align="end">
              {TRANSPORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldLabelRow>
        <FieldLabelRow layout="inline" label="Test email" description={lastTestSendLabel(lastTest)}>
          <span className="admin-row-actions">
            {lastTest ? (
              <Tag
                label={lastTest.accepted ? "Accepted" : "Not accepted"}
                tone={lastTest.accepted ? "success" : "warning"}
                dot
              />
            ) : null}
            <Button
              label="Send test email"
              variant="outline"
              size="sm"
              disabled={!capability.canSubmit}
              onClick={() => setTestSendOpen(true)}
            />
          </span>
        </FieldLabelRow>
      </WorkspacePageSection>

      <WorkspacePageSection title="SMTP" icon={<Server aria-hidden />}>
        <p className="workspace-page-section__lead">
          Optional. Only for a mail provider or your own mail server.
        </p>
        <FieldLabelRow layout="inline" fill label="Host" htmlFor="admin-mail-delivery-smtp-host">
          <Input
            id="admin-mail-delivery-smtp-host"
            placeholder="smtp.example.com"
            value={form.mailDeliverySmtpHost}
            onChange={(event) => type({ mailDeliverySmtpHost: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow layout="inline" label="Port" htmlFor="admin-mail-delivery-smtp-port">
          <Input
            id="admin-mail-delivery-smtp-port"
            type="number"
            className="admin-number-input"
            value={String(form.mailDeliverySmtpPort)}
            onChange={(event) => type({ mailDeliverySmtpPort: Number(event.target.value) || 0 })}
          />
        </FieldLabelRow>
        <FieldLabelRow layout="inline" label="Security" htmlFor="admin-mail-delivery-smtp-security">
          <Select
            value={form.mailDeliverySmtpSecurity || "starttls"}
            onValueChange={(value) => choose({ mailDeliverySmtpSecurity: value })}
          >
            <CollectionGhostSelectTrigger
              id="admin-mail-delivery-smtp-security"
              aria-label="Security"
              label={<SelectValue />}
            />
            <SelectContent align="end">
              {SECURITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          fill
          label="Username"
          description="Empty for a local relay."
          htmlFor="admin-mail-delivery-smtp-username"
        >
          <Input
            id="admin-mail-delivery-smtp-username"
            value={form.mailDeliverySmtpUsername}
            onChange={(event) => type({ mailDeliverySmtpUsername: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          fill
          label="Password"
          description={delivery.config.smtpPasswordSet ? "Saved. Empty keeps it." : undefined}
          htmlFor="admin-mail-delivery-smtp-password"
        >
          <span className="admin-value-control">
            <Input
              id="admin-mail-delivery-smtp-password"
              variant="password"
              autoComplete="new-password"
              value={form.mailDeliverySmtpPassword}
              onChange={(event) => type({ mailDeliverySmtpPassword: event.target.value })}
            />
            {delivery.config.smtpPasswordSet ? (
              <Button
                label="Clear"
                variant="ghost"
                onClick={() =>
                  clear(
                    "mailDeliverySmtpPassword",
                    controller.actions.clearMailDeliverySmtpPassword,
                  )
                }
              />
            ) : null}
          </span>
        </FieldLabelRow>
      </WorkspacePageSection>

      <WorkspacePageSection title="Invitations" icon={<Mail aria-hidden />}>
        <FeatureRow
          label="Invite people outside this server"
          desc="Email invitations to outside addresses. Updates and replies always send."
          value={form.imipExternalEnabled}
          onChange={(next) => choose({ imipExternalEnabled: next })}
        />
        <FieldLabelRow
          layout="inline"
          label="Per hour"
          description="Per person."
          htmlFor="admin-email-delivery-imip-hourly-limit"
        >
          <Input
            id="admin-email-delivery-imip-hourly-limit"
            type="number"
            min={1}
            className="admin-number-input"
            value={form.imipHourlyLimit}
            onChange={(event) => type({ imipHourlyLimit: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          label="Per day"
          description="Per person."
          htmlFor="admin-email-delivery-imip-daily-limit"
        >
          <Input
            id="admin-email-delivery-imip-daily-limit"
            type="number"
            min={1}
            className="admin-number-input"
            value={form.imipDailyLimit}
            onChange={(event) => type({ imipDailyLimit: event.target.value })}
          />
        </FieldLabelRow>
      </WorkspacePageSection>

      <MailDeliveryTestDialog
        open={testSendOpen}
        onOpenChange={setTestSendOpen}
        onSubmit={async (to) => {
          if (await controller.actions.sendMailDeliveryTest(to)) {
            setTestSendOpen(false);
          }
        }}
      />
    </>
  );
}
