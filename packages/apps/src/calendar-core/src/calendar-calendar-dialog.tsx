import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  groupSlugFromOwnerScopeValue,
  OwnerScopeField,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
} from "@/ui/owner-scope-field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import type { CalendarDirectoryGroup, CalendarFeedInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarColorSwatchTrigger } from "@/calendar-core/src/calendar-color-swatch-trigger";
import { CalendarPublishSection } from "@/calendar-core/src/calendar-publish-section";
import {
  inferCalendarNameFromUrl,
  isLikelyCalendarFeedUrl,
} from "@/calendar-core/src/calendar-subscription";
import "@/share-ui/share-ui.css";
import "./calendar-calendar-dialog.css";

export const CALENDAR_COLOR_SWATCHES = [
  "#6366f1",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
] as const;

export const DEFAULT_CALENDAR_COLOR = CALENDAR_COLOR_SWATCHES[0];

export type CalendarCalendarDialogState =
  | null
  | { mode: "create" }
  | { mode: "subscribe" }
  | {
      mode: "edit";
      calendarId: string;
      name: string;
      color: string;
      mayDelete: boolean;
      scope?: "personal" | "group";
      groupSlug?: string | null;
      subscriptionId?: string | null;
      sourceUrl?: string;
      canPublish?: boolean;
    };

export type CalendarCalendarDialogConfirmInput = {
  name: string;
  color: string;
  groupSlug?: string | null;
  url?: string;
  /** True when the user edited the name; inferred URL defaults are not marked. */
  nameTouched?: boolean;
};

export type CalendarCalendarDialogPublish = {
  feed: CalendarFeedInfo | null;
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onCopyHttps: () => void;
  onCopyWebcal: () => void;
};

type CalendarCalendarDialogProps = {
  dialog: CalendarCalendarDialogState;
  labels: CalendarUILabels;
  groups?: CalendarDirectoryGroup[];
  personalOwnerLabel?: string;
  busy?: boolean;
  publish?: CalendarCalendarDialogPublish;
  onClose: () => void;
  onConfirm: (input: CalendarCalendarDialogConfirmInput) => void;
  onDelete?: () => void;
};

export function CalendarCalendarDialog({
  dialog,
  labels,
  groups = [],
  personalOwnerLabel = "Me",
  busy = false,
  publish,
  onClose,
  onConfirm,
  onDelete,
}: CalendarCalendarDialogProps) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [color, setColor] = useState<string>(DEFAULT_CALENDAR_COLOR);
  const [url, setUrl] = useState("");
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";
  const isSubscribe = dialog?.mode === "subscribe";
  const isSubscriptionEdit = dialog?.mode === "edit" && Boolean(dialog.subscriptionId);
  const showPublish = dialog?.mode === "edit" && dialog.canPublish && Boolean(publish);

  useEffect(() => {
    if (!dialog) {
      setConfirmDeleteOpen(false);
      return;
    }
    if (dialog.mode === "create") {
      setName("");
      setNameTouched(false);
      setColor(DEFAULT_CALENDAR_COLOR);
      setUrl("");
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    if (dialog.mode === "subscribe") {
      setName("");
      setNameTouched(false);
      setColor(DEFAULT_CALENDAR_COLOR);
      setUrl("");
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    setName(dialog.name);
    setColor(dialog.color || DEFAULT_CALENDAR_COLOR);
    setUrl(dialog.sourceUrl ?? "");
    setScopeValue(ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug));
  }, [dialog]);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const selectedColor = color.trim() || DEFAULT_CALENDAR_COLOR;
  const unchangedEdit =
    dialog?.mode === "edit" &&
    trimmedName === dialog.name.trim() &&
    selectedColor.toLowerCase() === dialog.color.trim().toLowerCase();
  const subscribeUrlValid = isLikelyCalendarFeedUrl(trimmedUrl);
  const canSubmit = isSubscribe
    ? subscribeUrlValid && !busy
    : Boolean(trimmedName) && (isCreate || !unchangedEdit) && !busy;
  const canRemove = dialog?.mode === "edit" && dialog.mayDelete && Boolean(onDelete);
  const ownerLabels = {
    label: labels.calendarDirectoryLabel,
    personal: labels.calendarDirectoryPersonal,
    group: labels.calendarDirectoryGroup,
    readOnlyLabel: labels.calendarDirectoryReadOnlyLabel,
  };
  const title = isSubscribe
    ? labels.subscribeCalendarTitle
    : isCreate
      ? labels.createCalendarTitle
      : labels.editCalendarTitle;
  const removeLabel = isSubscriptionEdit ? labels.unsubscribeCalendar : labels.deleteCalendar;
  const removeTitle = isSubscriptionEdit
    ? labels.unsubscribeCalendarConfirmTitle
    : labels.deleteCalendarConfirmTitle;
  const removeDescription = isSubscriptionEdit
    ? labels.unsubscribeCalendarConfirmDescription
    : labels.deleteCalendarConfirmDescription;
  const removeActionLabel = isSubscriptionEdit ? labels.unsubscribeCalendar : labels.delete;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
        <DialogContent className="calendar-dialog-surface" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onConfirm({
                name: trimmedName,
                color: selectedColor,
                ...(isCreate || isSubscribe
                  ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) }
                  : {}),
                ...(isSubscribe ? { url: trimmedUrl, nameTouched } : {}),
              });
            }}
          >
            {isSubscribe || isSubscriptionEdit ? (
              <FieldLabelRow label={labels.subscribeUrlLabel} htmlFor="calendar-subscribe-url">
                <ShareDialogInput
                  id="calendar-subscribe-url"
                  type="url"
                  autoFocus={isSubscribe}
                  value={url}
                  readOnly={isSubscriptionEdit}
                  disabled={busy}
                  placeholder={labels.subscribeUrlPlaceholder}
                  onChange={(event) => {
                    const nextUrl = event.target.value;
                    setUrl(nextUrl);
                    if (isSubscribe && !nameTouched) {
                      setName(inferCalendarNameFromUrl(nextUrl));
                    }
                  }}
                />
              </FieldLabelRow>
            ) : null}

            <FieldLabelRow label={labels.calendarNameLabel} htmlFor="calendar-calendar-name">
              <div className="calendar-calendar-dialog__name-color-row">
                <Input
                  id="calendar-calendar-name"
                  className="calendar-calendar-dialog__name-input"
                  autoFocus={!isSubscribe}
                  value={name}
                  disabled={busy}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                  }}
                />
                <SwatchColorPicker
                  value={selectedColor}
                  onChange={setColor}
                  colorLabel={labels.calendarColorLabel}
                  swatches={CALENDAR_COLOR_SWATCHES}
                >
                  <CalendarColorSwatchTrigger
                    color={selectedColor}
                    label={labels.calendarColorLabel}
                    aria-haspopup="dialog"
                  />
                </SwatchColorPicker>
              </div>
            </FieldLabelRow>

            <OwnerScopeField
              id="calendar-calendar-directory"
              value={scopeValue}
              onValueChange={setScopeValue}
              groups={groups}
              personalOwnerLabel={personalOwnerLabel}
              labels={ownerLabels}
              disabled={(!isCreate && !isSubscribe) || busy}
            />

            {showPublish && publish ? (
              <CalendarPublishSection
                labels={labels}
                feed={publish.feed}
                busy={publish.busy || busy}
                disabled={busy}
                onToggle={publish.onToggle}
                onCopyHttps={publish.onCopyHttps}
                onCopyWebcal={publish.onCopyWebcal}
              />
            ) : null}

            <DialogFooter className="calendar-calendar-dialog__footer">
              {canRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="calendar-calendar-dialog__delete"
                  disabled={busy}
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  {removeLabel}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isSubscribe ? labels.subscribeCalendar : labels.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => !busy && setConfirmDeleteOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{removeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                onDelete?.();
                setConfirmDeleteOpen(false);
              }}
            >
              {removeActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
