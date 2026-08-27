import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
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
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import type {
  CalendarDirectoryGroup,
  CalendarFeedInfo,
  CalendarInfo,
} from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarPublishSection } from "@/calendar-core/src/calendar-publish-section";
import { CalendarShareSection } from "@/calendar-core/src/calendar-share-section";
import type { CalendarSharePrincipal, CalendarShareWith } from "@/calendar-core/src/calendar-share";
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
      /** Lock the name field. ACL sharees leave this unset so they can rename their instance. */
      nameReadOnly?: boolean;
      /** ACL sharee leave — does not delete the owner's collection. */
      removeShared?: boolean;
      /** Enable Owner (personal ↔ group), same options as create. */
      canChangeOwner?: boolean;
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
};

export type CalendarCalendarDialogShare = {
  calendar: CalendarInfo;
  knownPrincipals?: readonly CalendarSharePrincipal[];
  online?: boolean;
  onSearchPrincipals: (query: string) => Promise<CalendarSharePrincipal[]>;
  onPatchShareWith: (calendarId: string, shareWith: CalendarShareWith) => Promise<void>;
};

type CalendarCalendarDialogProps = {
  dialog: CalendarCalendarDialogState;
  labels: CalendarUILabels;
  groups?: CalendarDirectoryGroup[];
  personalOwnerLabel?: string;
  busy?: boolean;
  publish?: CalendarCalendarDialogPublish;
  share?: CalendarCalendarDialogShare;
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
  share,
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
  const [confirmOwnerOpen, setConfirmOwnerOpen] = useState(false);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";
  const isSubscribe = dialog?.mode === "subscribe";
  const isSubscriptionEdit = dialog?.mode === "edit" && Boolean(dialog.subscriptionId);
  const nameReadOnly = dialog?.mode === "edit" && Boolean(dialog.nameReadOnly);
  const isSharedRemove = dialog?.mode === "edit" && Boolean(dialog.removeShared);
  const showPublish = dialog?.mode === "edit" && dialog.canPublish && Boolean(publish);
  const showShare = dialog?.mode === "edit" && Boolean(share);
  const canChangeOwner =
    isCreate || isSubscribe || (dialog?.mode === "edit" && Boolean(dialog.canChangeOwner));

  useEffect(() => {
    if (!dialog) {
      setConfirmDeleteOpen(false);
      setConfirmOwnerOpen(false);
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
  const ownerUnchanged =
    dialog?.mode === "edit" &&
    ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug) === scopeValue;
  const unchangedEdit =
    dialog?.mode === "edit" &&
    trimmedName === dialog.name.trim() &&
    selectedColor.toLowerCase() === dialog.color.trim().toLowerCase() &&
    ownerUnchanged;
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
  const removeLabel = isSubscriptionEdit
    ? labels.unsubscribeCalendar
    : isSharedRemove
      ? labels.removeSharedCalendar
      : labels.deleteCalendar;
  const removeTitle = isSubscriptionEdit
    ? labels.unsubscribeCalendarConfirmTitle
    : isSharedRemove
      ? labels.removeSharedCalendarConfirmTitle
      : labels.deleteCalendarConfirmTitle;
  const removeDescription = isSubscriptionEdit
    ? labels.unsubscribeCalendarConfirmDescription
    : isSharedRemove
      ? labels.removeSharedCalendarConfirmDescription
      : labels.deleteCalendarConfirmDescription;
  const removeActionLabel = isSubscriptionEdit
    ? labels.unsubscribeCalendar
    : isSharedRemove
      ? labels.removeSharedCalendar
      : labels.delete;
  const ownerTransferPending = dialog?.mode === "edit" && canChangeOwner && !ownerUnchanged;
  const nextOwnerGroupSlug = groupSlugFromOwnerScopeValue(scopeValue);
  const ownerConfirmDescription = nextOwnerGroupSlug
    ? labels.changeCalendarOwnerConfirmToGroup(
        groups.find((group) => group.slug === nextOwnerGroupSlug)?.displayName ??
          nextOwnerGroupSlug,
      )
    : labels.changeCalendarOwnerConfirmToPersonal;

  const confirmInput = (): CalendarCalendarDialogConfirmInput => ({
    name: trimmedName,
    color: selectedColor,
    ...(isCreate || isSubscribe || canChangeOwner
      ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) }
      : {}),
    ...(isSubscribe ? { url: trimmedUrl, nameTouched } : {}),
  });

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
              if (ownerTransferPending) {
                setConfirmOwnerOpen(true);
                return;
              }
              onConfirm(confirmInput());
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
              <NameColorRow>
                <Input
                  id="calendar-calendar-name"
                  className={NAME_COLOR_ROW_INPUT_CLASS}
                  autoFocus={!isSubscribe && !nameReadOnly}
                  value={name}
                  disabled={busy || nameReadOnly}
                  readOnly={nameReadOnly}
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
                  <ColorSwatchTrigger
                    color={selectedColor}
                    label={labels.calendarColorLabel}
                    aria-haspopup="dialog"
                  />
                </SwatchColorPicker>
              </NameColorRow>
            </FieldLabelRow>

            <OwnerScopeField
              id="calendar-calendar-directory"
              value={scopeValue}
              onValueChange={setScopeValue}
              groups={groups}
              personalOwnerLabel={personalOwnerLabel}
              labels={ownerLabels}
              disabled={!canChangeOwner || busy}
            />

            {showPublish && publish ? (
              <CalendarPublishSection
                labels={labels}
                feed={publish.feed}
                busy={publish.busy || busy}
                disabled={busy}
                onToggle={publish.onToggle}
                onCopyHttps={publish.onCopyHttps}
              />
            ) : null}

            {showShare && share ? (
              <div className="calendar-calendar-dialog__share">
                <CalendarShareSection
                  calendar={share.calendar}
                  labels={labels}
                  knownPrincipals={share.knownPrincipals}
                  disabled={busy}
                  online={share.online}
                  onSearchPrincipals={share.onSearchPrincipals}
                  onPatchShareWith={share.onPatchShareWith}
                />
              </div>
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
        open={confirmOwnerOpen}
        onOpenChange={(next) => !busy && setConfirmOwnerOpen(next)}
      >
        <AlertDialogContent className="calendar-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.changeCalendarOwnerConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ownerConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={busy}>
                {labels.cancel}
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm(confirmInput());
                  setConfirmOwnerOpen(false);
                }}
              >
                {labels.changeCalendarOwnerConfirm}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => !busy && setConfirmDeleteOpen(next)}
      >
        <AlertDialogContent className="calendar-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{removeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={busy}>
                {labels.cancel}
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  onDelete?.();
                  setConfirmDeleteOpen(false);
                }}
              >
                {removeActionLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
