import { useId, type ReactNode } from "react";
import { useWatch } from "react-hook-form";
import { Mail } from "lucide-react";
import { Button } from "@/button/src/button";
import { incomingEmailLabels as labels } from "@/settings-core/src/settings-incoming-email-labels";
import {
  usualIncomingEmailPort,
  type IncomingEmailFormValues,
  type IncomingMailbox,
  type IncomingMailboxOperations,
} from "@/settings-core/src/settings-incoming-email-source";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsIncomingEmail,
  type SettingsIncomingEmailController,
} from "@/settings-core/src/use-settings-incoming-email";
import { Form, FormField } from "@/ui/form";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import "./settings-incoming-email-pane.css";

/**
 * Settings → Incoming email (#1589): the IMAP mailbox apps read for the user, such as Calendar
 * for invitation replies. Connect and Save log in to the mailbox first; nothing is stored when
 * that fails. Which folder an app reads is that app's own setting.
 */
export function SettingsIncomingEmailPane({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: IncomingMailboxOperations;
}) {
  const controller = useSettingsIncomingEmail(operations);
  return (
    <SettingsPaneCard title={labels.title} icon={<Mail aria-hidden />}>
      <IncomingEmailBody controller={controller} />
    </SettingsPaneCard>
  );
}

function IncomingEmailBody({ controller }: { controller: SettingsIncomingEmailController }) {
  const { phase, retry } = controller;
  if (phase === "loading" || phase === "offline") {
    return (
      <p className="settings-incoming-email__note" role="status">
        {phase === "loading" ? labels.loading : labels.offline}
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div className="settings-incoming-email__actions" role="alert">
        <p className="settings-incoming-email__note">{labels.loadError}</p>
        <Button type="button" variant="outline" size="sm" label={labels.retry} onClick={retry} />
      </div>
    );
  }
  return <IncomingEmailForm controller={controller} />;
}

/** "13 Nov, 02:19"; the year only when it is not this year. */
function formatChecked(iso: string): string {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** One line on how reading goes: the error, a pause, waiting for a first message, or fine. */
export function incomingEmailStatusLine(mailbox: IncomingMailbox): string {
  const checked = mailbox.lastCheckedAt
    ? ` ${labels.lastChecked(formatChecked(mailbox.lastCheckedAt))}`
    : "";
  if (!mailbox.active) return labels.statusPaused;
  if (mailbox.lastError) return `${labels.errors[mailbox.lastError] ?? labels.failed}${checked}`;
  if (!mailbox.trustedServer) return labels.statusWaiting;
  return `${labels.statusReading}${checked}`;
}

function TextRow({
  name,
  label,
  description,
  control,
  type = "text",
  autoComplete,
  placeholder,
}: {
  name: Exclude<keyof IncomingEmailFormValues, "security">;
  label: string;
  description?: string;
  control: SettingsIncomingEmailController["form"]["control"];
  type?: "text" | "password";
  autoComplete?: string;
  placeholder?: string;
}): ReactNode {
  const id = useId();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FieldLabelRow layout="inline" label={label} description={description} htmlFor={id}>
          <Input
            id={id}
            {...field}
            variant={type === "password" ? "password" : "default"}
            inputMode={name === "port" ? "numeric" : undefined}
            autoComplete={autoComplete}
            spellCheck={false}
            placeholder={placeholder}
          />
        </FieldLabelRow>
      )}
    />
  );
}

function IncomingEmailForm({ controller }: { controller: SettingsIncomingEmailController }) {
  const { form, mailbox, busy, failure } = controller;
  const securityId = useId();
  const security = useWatch({ control: form.control, name: "security" });
  const connected = mailbox !== null;
  const { isDirty } = form.formState;
  return (
    <Form {...form}>
      <form
        className="settings-incoming-email"
        onSubmit={(event) => {
          event.preventDefault();
          controller.save();
        }}
      >
        <p className="settings-incoming-email__note">{labels.intro}</p>
        {mailbox ? (
          <p className="settings-incoming-email__status" role="status">
            {incomingEmailStatusLine(mailbox)}
          </p>
        ) : null}
        <TextRow
          name="host"
          label={labels.host}
          description={labels.hostHint}
          control={form.control}
        />
        <FormField
          control={form.control}
          name="security"
          render={({ field }) => (
            <FieldLabelRow layout="inline" label={labels.security} htmlFor={securityId}>
              <Select value={field.value} onValueChange={field.onChange}>
                <CollectionGhostSelectTrigger id={securityId} label={<SelectValue />} />
                <SelectContent align="end">
                  <SelectItem value="ssl">{labels.securitySsl}</SelectItem>
                  <SelectItem value="starttls">{labels.securityStarttls}</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabelRow>
          )}
        />
        <TextRow
          name="port"
          label={labels.port}
          description={labels.portHint}
          control={form.control}
          placeholder={String(usualIncomingEmailPort(security))}
        />
        <TextRow
          name="username"
          label={labels.username}
          description={labels.usernameHint}
          control={form.control}
          autoComplete="off"
        />
        <TextRow
          name="password"
          label={labels.password}
          description={connected ? labels.passwordKeep : undefined}
          control={form.control}
          type="password"
          autoComplete="new-password"
        />
        <div className="settings-incoming-email__actions">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            label={connected ? labels.save : labels.connect}
            disabled={busy !== null || (connected && !isDirty)}
          />
          {connected ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                label={labels.check}
                disabled={busy !== null}
                onClick={controller.check}
              />
              <Button
                type="button"
                variant="outline"
                severity="danger"
                size="sm"
                label={labels.disconnect}
                disabled={busy !== null}
                onClick={controller.disconnect}
              />
            </>
          ) : null}
        </div>
        {failure ? (
          <p className="settings-incoming-email__failure" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    </Form>
  );
}
