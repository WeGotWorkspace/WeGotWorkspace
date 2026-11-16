import { useId } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button } from "@/button/src/button";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import { useSettingsDialog } from "@/settings-core/src/settings-dialog-context";
import type { IncomingMailboxOperations } from "@/settings-core/src/settings-incoming-email-source";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsCalendarReplyFolder,
  type SettingsCalendarReplyFolderController,
} from "@/settings-core/src/use-settings-calendar-reply-folder";
import { Form, FormField } from "@/ui/form";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import "./settings-incoming-email-pane.css";

/**
 * Invitation replies in Settings → Calendar (#1589): which folder of the user's mailbox
 * Calendar reads replies from. The mailbox is connected in Settings → Incoming email; without
 * one, the card links there.
 */
export function SettingsCalendarReplyFolderSection({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: IncomingMailboxOperations;
}) {
  const controller = useSettingsCalendarReplyFolder(operations);
  return (
    <SettingsPaneCard title={labels.title} icon={<MailCheck aria-hidden />}>
      <ReplyFolderBody controller={controller} />
    </SettingsPaneCard>
  );
}

function ReplyFolderBody({ controller }: { controller: SettingsCalendarReplyFolderController }) {
  const { phase, mailbox, retry } = controller;
  const { showPanel } = useSettingsDialog();
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
  if (!mailbox) {
    return (
      <div className="settings-incoming-email">
        <p className="settings-incoming-email__note">{labels.notConnected}</p>
        <div className="settings-incoming-email__actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            label={labels.openIncomingEmail}
            trailingIcon={<ArrowRight aria-hidden />}
            onClick={() => showPanel("incoming-email")}
          />
        </div>
      </div>
    );
  }
  return <ReplyFolderForm controller={controller} />;
}

function ReplyFolderForm({ controller }: { controller: SettingsCalendarReplyFolderController }) {
  const { form, failure } = controller;
  const id = useId();
  return (
    <Form {...form}>
      <div className="settings-incoming-email">
        <p className="settings-incoming-email__note">{labels.intro}</p>
        <FormField
          control={form.control}
          name="folder"
          render={({ field }) => (
            <FieldLabelRow
              layout="inline"
              label={labels.folder}
              description={labels.folderHint}
              htmlFor={id}
            >
              <Input id={id} {...field} spellCheck={false} autoComplete="off" />
            </FieldLabelRow>
          )}
        />
        {failure ? (
          <p className="settings-incoming-email__failure" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
    </Form>
  );
}
