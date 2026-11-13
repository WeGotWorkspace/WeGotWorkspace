import { useId, type ReactNode } from "react";
import { useWatch } from "react-hook-form";
import { MailCheck } from "lucide-react";
import { Button } from "@/button/src/button";
import type { CalendarReplyMailboxOperations } from "@/lib/api/wgw/calendar-reply-mailbox";
import { calendarReplyMailboxLabels as labels } from "@/settings-core/src/settings-calendar-reply-mailbox-labels";
import {
  usualReplyMailboxPort,
  type CalendarReplyMailboxFormValues,
} from "@/settings-core/src/settings-calendar-reply-mailbox-source";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsCalendarReplyMailbox,
  type SettingsCalendarReplyMailboxController,
} from "@/settings-core/src/use-settings-calendar-reply-mailbox";
import { Form, FormField } from "@/ui/form";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import type { CalendarReplyMailbox } from "@wgw/openapi-types/calendars-types";
import "./settings-calendar-reply-mailbox-section.css";

/**
 * Invitation replies in Settings → Calendar (#1589): the IMAP mailbox the owner's invitations
 * are sent from, so replies from other calendar apps update their events. Connect and Save log
 * in to the mailbox first; nothing is stored when that fails.
 */
export function SettingsCalendarReplyMailboxSection({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: CalendarReplyMailboxOperations;
}) {
  const controller = useSettingsCalendarReplyMailbox(operations);
  return (
    <SettingsPaneCard title={labels.title} icon={<MailCheck aria-hidden />}>
      <ReplyMailboxBody controller={controller} />
    </SettingsPaneCard>
  );
}

function ReplyMailboxBody({ controller }: { controller: SettingsCalendarReplyMailboxController }) {
  const { phase, retry } = controller;
  if (phase === "loading" || phase === "offline") {
    return (
      <p className="settings-reply-mailbox__status" role="status">
        {phase === "loading" ? labels.loading : labels.offline}
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div className="settings-reply-mailbox__actions" role="alert">
        <p className="settings-reply-mailbox__status">{labels.loadError}</p>
        <Button type="button" variant="outline" size="sm" label={labels.retry} onClick={retry} />
      </div>
    );
  }
  return <ReplyMailboxForm controller={controller} />;
}

function formatChecked(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** One line on how reading goes: the error, a pause, waiting for a first message, or fine. */
function statusLine(mailbox: CalendarReplyMailbox): string {
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
  name: Exclude<keyof CalendarReplyMailboxFormValues, "security">;
  label: string;
  description?: string;
  control: SettingsCalendarReplyMailboxController["form"]["control"];
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

function ReplyMailboxForm({ controller }: { controller: SettingsCalendarReplyMailboxController }) {
  const { form, mailbox, busy, failure } = controller;
  const securityId = useId();
  const security = useWatch({ control: form.control, name: "security" });
  const connected = mailbox !== null;
  const { isDirty } = form.formState;
  return (
    <Form {...form}>
      <form
        className="settings-reply-mailbox"
        onSubmit={(event) => {
          event.preventDefault();
          controller.save();
        }}
      >
        <p className="settings-reply-mailbox__intro">{labels.intro}</p>
        {mailbox ? (
          <p className="settings-reply-mailbox__status" role="status">
            {statusLine(mailbox)}
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
          placeholder={String(usualReplyMailboxPort(security))}
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
          description={connected ? labels.passwordKeep : labels.passwordHint}
          control={form.control}
          type="password"
          autoComplete="new-password"
        />
        <TextRow
          name="folder"
          label={labels.folder}
          description={labels.folderHint}
          control={form.control}
        />
        <div className="settings-reply-mailbox__actions">
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
          <p className="settings-reply-mailbox__failure" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    </Form>
  );
}
