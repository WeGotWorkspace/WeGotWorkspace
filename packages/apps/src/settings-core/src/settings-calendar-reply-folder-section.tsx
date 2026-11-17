import { useId } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button } from "@/button/src/button";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import { useSettingsDialog } from "@/settings-core/src/settings-dialog-context";
import type { IncomingMailboxOperations } from "@/settings-core/src/settings-incoming-email-source";
import { SettingsInfoButton } from "@/settings-core/src/settings-info-button";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsCalendarReplyFolder,
  type SettingsCalendarReplyFolderController,
} from "@/settings-core/src/use-settings-calendar-reply-folder";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import "./settings-incoming-email-pane.css";

/**
 * Invitation replies in Settings → Calendar (#1589): which folder of the user's mailbox
 * Calendar reads replies from, picked from the mailbox's own folders (JMAP Mailbox/get). The
 * mailbox is connected in Settings → Incoming email; without one, the card links there.
 */
export function SettingsCalendarReplyFolderSection({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: IncomingMailboxOperations;
}) {
  const controller = useSettingsCalendarReplyFolder(operations);
  return (
    <SettingsPaneCard
      title={labels.title}
      icon={<MailCheck aria-hidden />}
      action={<SettingsInfoButton label={labels.about}>{labels.reading}</SettingsInfoButton>}
    >
      <ReplyFolderBody controller={controller} />
    </SettingsPaneCard>
  );
}

function ReplyFolderBody({ controller }: { controller: SettingsCalendarReplyFolderController }) {
  const { phase, mailbox, retry } = controller;
  const { showPanel } = useSettingsDialog();
  if (phase === "loading") return <ReplyFolderLoading />;
  if (phase === "offline") {
    return (
      <p className="settings-incoming-email__note" role="status">
        {labels.offline}
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
      // Same rows as connected, the link where the dropdown goes: nothing shifts when it loads.
      <div className="settings-incoming-email">
        <p className="settings-incoming-email__note">{labels.intro}</p>
        <FieldLabelRow layout="inline" label={labels.mailbox} description={labels.notConnected}>
          <span className="settings-incoming-email__folder">
            <Button
              type="button"
              variant="outline"
              size="sm"
              label={labels.openIncomingEmail}
              trailingIcon={<ArrowRight aria-hidden />}
              onClick={() => showPanel("incoming-email")}
            />
          </span>
        </FieldLabelRow>
      </div>
    );
  }
  return <ReplyFolderForm controller={controller} />;
}

/** The connected layout, with a spinner where the dropdown goes: nothing shifts when it loads. */
function ReplyFolderLoading() {
  return (
    <div className="settings-incoming-email">
      <p className="settings-incoming-email__note">{labels.intro}</p>
      <FieldLabelRow layout="inline" label={labels.folder} description={labels.folderHint}>
        <span className="settings-incoming-email__folder" role="status" aria-label={labels.loading}>
          <LoadingSpinner size="sm" />
        </span>
      </FieldLabelRow>
    </div>
  );
}

function ReplyFolderForm({ controller }: { controller: SettingsCalendarReplyFolderController }) {
  const { mailbox, folderList, savingFolderId, failure } = controller;
  const id = useId();
  if (!mailbox) return null;
  const folderId = savingFolderId ?? mailbox.folderId;
  // Until the list loads, the saved folder is the one option.
  const folders =
    folderList.status === "ready" && folderList.folders.some((folder) => folder.id === folderId)
      ? folderList.folders
      : [
          { id: mailbox.folderId, label: mailbox.folder, role: null },
          ...(folderList.status === "ready"
            ? folderList.folders.filter((folder) => folder.id !== mailbox.folderId)
            : []),
        ];
  return (
    <div className="settings-incoming-email">
      <p className="settings-incoming-email__note">{labels.intro}</p>
      <FieldLabelRow
        layout="inline"
        label={labels.folder}
        description={labels.folderHint}
        htmlFor={id}
      >
        <span className="settings-incoming-email__folder">
          {savingFolderId ? <LoadingSpinner size="sm" /> : null}
          <Select
            value={folderId}
            disabled={savingFolderId !== null}
            onOpenChange={(open) => open && controller.loadFolders()}
            onValueChange={controller.chooseFolder}
          >
            <CollectionGhostSelectTrigger id={id} label={<SelectValue />} />
            <SelectContent align="end">
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.label}
                </SelectItem>
              ))}
              {folderList.status === "loading" ? (
                <div className="settings-incoming-email__folder-status" role="status">
                  <LoadingSpinner size="sm" />
                  {labels.foldersLoading}
                </div>
              ) : null}
              {folderList.status === "error" ? (
                <div className="settings-incoming-email__folder-status" role="alert">
                  {folderList.failure}
                </div>
              ) : null}
            </SelectContent>
          </Select>
        </span>
      </FieldLabelRow>
      {failure ? (
        <p className="settings-incoming-email__failure" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
