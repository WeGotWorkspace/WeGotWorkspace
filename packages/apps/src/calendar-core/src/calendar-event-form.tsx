import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link2, MapPin } from "lucide-react";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  sessionEventInviteeStatus,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { CalendarEventFormSecondary } from "@/calendar-core/src/calendar-event-form-secondary";
import { CalendarMeetChannelEmailDialog } from "@/calendar-core/src/calendar-meet-channel-email-dialog";
import { useCalendarMeetChannelEmailCollision } from "@/calendar-core/src/use-calendar-meet-channel-email";
import { calendarRespondStatus } from "@/calendar-core/src/calendar-rsvp-actions";
import { CalendarEventFormFooter } from "@/calendar-core/src/calendar-event-form-footer";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventFormIsValid,
  patchCalendarEventForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormRecurrence } from "@/calendar-core/src/calendar-event-form-recurrence";
import { CalendarEventFormShowAs } from "@/calendar-core/src/calendar-event-form-show-as";
import { CalendarEventFormTitle } from "@/calendar-core/src/calendar-event-form-title";
import { CalendarEventFormWhen } from "@/calendar-core/src/calendar-event-form-when";
import { isCalendarEventFormReadOnly } from "@/calendar-core/src/calendar-collection-write";
import type { ControlSize } from "@/ui/control-size";
import { cn } from "@/lib/utils";
import "./calendar-event-dialog.css";

export type CalendarEventFormLayout = {
  hideCalendarPicker?: boolean;
  hideLocation?: boolean;
  hideWhen?: boolean;
  hideRecurrence?: boolean;
  hideAlarms?: boolean;
  hideShowAs?: boolean;
  hideInvitees?: boolean;
  hideNotes?: boolean;
  /** Meeting URL is copy-only; no generate menu or channel picker. */
  meetCopyOnly?: boolean;
};

export type CalendarEventFormProps = {
  /** `invitation` = invitee details popover: fields read-only except calendar; RSVP footer. */
  mode: "create" | "edit" | "invitation";
  form: CalendarEventFormValue;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  /** BCP 47 tag; defaults to the same resolver the Lit calendar surface uses. */
  locale?: string;
  busy?: boolean;
  submitLabel?: string;
  /** Rendered after Meet in the Location+Meet group (e.g. Meet Schedule switch). */
  afterMeetAccessory?: ReactNode;
  className?: string;
  layout?: CalendarEventFormLayout;
  /** Extra gate on Save/Create (ANDed with form validity). */
  canSubmit?: boolean;
  onChange: (next: CalendarEventFormValue) => void;
  onClose: () => void;
  onSave: (scope?: RecurrenceEditScope) => void;
  onDelete?: () => void;
  recurrenceId?: string;
  recurrenceSaveScope?: RecurrenceEditScope;
  thisInstanceLocked?: boolean;
  meetOperations?: CalendarMeetOperations;
  workspaceOrigin?: string;
  sessionUsername?: string;
  onJoinMeeting?: (href: string) => void;
  invitees?: CalendarInvitee[];
  contactCards?: ContactCard[];
  onRefreshContactCards?: () => void;
  canSubmitEmail?: boolean;
  sessionEmail?: string;
  onRsvp?: (
    status: CalendarSchedulingRespondStatus,
    calendarId?: string,
  ) => void | boolean | Promise<void | boolean>;
  /** Collision dialog surface class (defaults to calendar dialog surface). */
  collisionContentClassName?: string;
  /** When false, skip autofocus on the title (popover hosts focus on the shell). */
  autoFocusTitle?: boolean;
  /**
   * Shared control height for Inputs / Selects / LocaleDatePicker / buttons.
   * Dialogs and the interactive details popover use `sm` (32px) at every breakpoint.
   */
  controlSize?: ControlSize;
};

function fieldIcon(node: ReactNode): ReactNode {
  return node;
}

/** Editable event fields + footer shared by the create dialog and interactive details popover. */
export function CalendarEventForm({
  mode,
  form,
  calendars,
  labels,
  locale: localeProp,
  busy = false,
  submitLabel,
  afterMeetAccessory,
  className,
  layout,
  canSubmit = true,
  onChange,
  onClose,
  onSave,
  onDelete,
  invitees = [],
  contactCards = [],
  onRefreshContactCards,
  canSubmitEmail = true,
  sessionEmail,
  onRsvp,
  recurrenceId,
  recurrenceSaveScope,
  thisInstanceLocked = false,
  meetOperations,
  workspaceOrigin = typeof window !== "undefined" ? window.location.origin : "",
  sessionUsername,
  onJoinMeeting,
  collisionContentClassName = "calendar-dialog-surface calendar-event-dialog",
  autoFocusTitle = true,
  controlSize = "sm",
}: CalendarEventFormProps) {
  const locale = useMemo(() => resolveLocale(localeProp), [localeProp]);
  const invitationMode = mode === "invitation";
  const isOrganizer = isSessionEventOrganizer(form.attendees, sessionEmail, invitees);
  const isInvitee = isSessionEventInvitee(form.attendees, sessionEmail, invitees);
  const inviteeRsvp = sessionEventInviteeStatus(form.attendees, sessionEmail, invitees);
  const incomingRsvp = calendarRespondStatus(inviteeRsvp);
  const calendar = calendars.find((entry) => entry.id === form.calendarId);
  const readOnly =
    invitationMode ||
    isCalendarEventFormReadOnly({
      mode: mode === "create" ? "create" : "edit",
      calendar,
      isOrganizer,
    });
  const fieldsDisabled = busy || readOnly;
  const showInviteeRsvp = mode === "edit" && Boolean(onRsvp) && isInvitee;
  const showInvitationRsvp = invitationMode && Boolean(onRsvp);
  const showSaveCancel = !invitationMode && (!readOnly || showInviteeRsvp);
  const calendarPickerInteractive = invitationMode || showInviteeRsvp;
  const [draftCalendarId, setDraftCalendarId] = useState(form.calendarId);
  const [draftRsvp, setDraftRsvp] = useState<CalendarSchedulingRespondStatus | "">(
    incomingRsvp ?? "",
  );
  const abandonStagedReserveRef = useRef<(() => void) | null>(null);
  // Draft Meet reserve TTL only — edit persist scope is asked at save.
  const meetReserveScope = thisInstanceLocked
    ? "thisInstance"
    : (recurrenceSaveScope ?? "thisAndFuture");

  const dismiss = () => {
    abandonStagedReserveRef.current?.();
    onClose();
  };

  useEffect(() => {
    setDraftCalendarId(form.calendarId);
    setDraftRsvp(incomingRsvp ?? "");
  }, [form.calendarId, incomingRsvp]);

  const valid = calendarEventFormIsValid(form);

  const {
    commitForm,
    trySave,
    collisionOpen,
    collisionBusy,
    showEmailGuestHint,
    cancelCollision,
    applyChoice,
  } = useCalendarMeetChannelEmailCollision({
    form,
    invitees,
    open: true,
    workspaceOrigin,
    meetOperations,
    calendar,
    username: sessionUsername,
    recurrenceId,
    recurrenceSaveScope: meetReserveScope,
    onChange,
    onSave,
  });

  const set = <K extends keyof CalendarEventFormValue>(
    key: K,
    value: CalendarEventFormValue[K],
  ) => {
    commitForm(patchCalendarEventForm(form, { [key]: value } as Partial<CalendarEventFormValue>));
  };

  const saveLabel =
    submitLabel ??
    (showInviteeRsvp ? labels.save : mode === "edit" ? labels.saveChanges : labels.save);

  return (
    <>
      <form
        className={cn(
          "calendar-event-dialog__form",
          controlSize === "sm" && "calendar-event-dialog__form--compact",
          className,
        )}
        lang={locale}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (showInviteeRsvp) {
            if (!draftRsvp) return;
            const previous = incomingRsvp ?? "";
            void Promise.resolve(onRsvp?.(draftRsvp, draftCalendarId || undefined)).catch(() => {
              setDraftRsvp(previous);
            });
            return;
          }
          if (readOnly || !valid) return;
          // Do not pre-supply Meet/recurrence scope — controller asks via
          // CalendarRecurrenceScopeDialog for repeating events.
          trySave();
        }}
      >
        <div className="calendar-event-dialog__fields">
          <CalendarEventFormTitle
            form={form}
            calendars={calendars}
            labels={labels}
            controlSize={controlSize}
            busy={busy}
            readOnly={readOnly}
            fieldsDisabled={fieldsDisabled}
            autoFocusTitle={autoFocusTitle}
            hideCalendarPicker={layout?.hideCalendarPicker}
            calendarPickerInteractive={calendarPickerInteractive}
            showInviteeRsvp={showInviteeRsvp}
            invitationMode={invitationMode}
            draftCalendarId={draftCalendarId}
            incomingRsvp={incomingRsvp}
            onDraftCalendarIdChange={setDraftCalendarId}
            onRsvp={onRsvp}
            onFieldChange={set}
          />

          <div className="calendar-event-dialog__field-group calendar-event-dialog__field-group--place">
            {layout?.hideLocation ? null : (
              <FieldLabelRow
                className="calendar-event-dialog__field calendar-event-dialog__field--location"
                label={labels.eventLocationLabel}
                labelMode="icon"
                icon={fieldIcon(<MapPin className="size-3.5" aria-hidden />)}
              >
                <Input
                  size={controlSize}
                  value={form.location}
                  onChange={(event) => set("location", event.target.value)}
                  placeholder={labels.eventLocationPlaceholder}
                  aria-label={labels.eventLocationLabel}
                  disabled={fieldsDisabled}
                />
              </FieldLabelRow>
            )}

            <CalendarMeetCard
              className="calendar-event-dialog__field calendar-event-dialog__field--meet"
              presentation="field"
              form={form}
              labels={labels}
              calendar={calendar}
              username={sessionUsername}
              workspaceOrigin={workspaceOrigin}
              recurrenceId={recurrenceId}
              recurrenceSaveScope={meetReserveScope}
              thisInstanceLocked={thisInstanceLocked}
              meetOperations={meetOperations}
              disabled={fieldsDisabled}
              readOnly={readOnly}
              copyOnly={invitationMode || layout?.meetCopyOnly}
              controlSize={controlSize}
              emailGuestHint={
                showEmailGuestHint ? labels.eventMeetEmailGuestsNoAccessHint : undefined
              }
              fieldIcon={fieldIcon(<Link2 className="size-3.5" aria-hidden />)}
              onChange={commitForm}
              abandonStagedReserveRef={abandonStagedReserveRef}
              onJoin={onJoinMeeting}
            />

            {afterMeetAccessory}
          </div>

          {layout?.hideWhen ? null : (
            <CalendarEventFormWhen
              form={form}
              labels={labels}
              locale={locale}
              controlSize={controlSize}
              disabled={fieldsDisabled}
              onFieldChange={set}
            />
          )}

          {layout?.hideRecurrence ? null : (
            <CalendarEventFormRecurrence
              form={form}
              labels={labels}
              locale={locale}
              controlSize={controlSize}
              disabled={fieldsDisabled}
              onChange={onChange}
              onFieldChange={set}
            />
          )}

          {layout?.hideShowAs ? null : (
            <CalendarEventFormShowAs
              form={form}
              labels={labels}
              controlSize={controlSize}
              disabled={fieldsDisabled}
              onFieldChange={set}
            />
          )}

          <CalendarEventFormSecondary
            form={form}
            labels={labels}
            invitees={invitees}
            contactCards={contactCards}
            onRefreshContactCards={onRefreshContactCards}
            busy={busy}
            readOnly={readOnly}
            fieldsDisabled={fieldsDisabled}
            canSubmitEmail={canSubmitEmail}
            sessionEmail={sessionEmail}
            controlSize={controlSize}
            meetEmailGuestHint={
              showEmailGuestHint ? labels.eventMeetEmailGuestsNoAccessHint : undefined
            }
            hideInvitees={layout?.hideInvitees}
            hideAlarms={layout?.hideAlarms}
            hideNotes={layout?.hideNotes}
            onFieldChange={set}
          />
        </div>

        <CalendarEventFormFooter
          mode={mode}
          labels={labels}
          busy={busy}
          controlSize={controlSize}
          readOnly={readOnly}
          valid={valid}
          canSubmit={canSubmit}
          saveLabel={saveLabel}
          showInvitationRsvp={showInvitationRsvp}
          showInviteeRsvp={showInviteeRsvp}
          showSaveCancel={showSaveCancel}
          inviteeRsvp={inviteeRsvp}
          draftRsvp={draftRsvp}
          draftCalendarId={draftCalendarId}
          onDraftRsvpChange={setDraftRsvp}
          onRsvp={onRsvp}
          onDelete={onDelete}
          onDismiss={dismiss}
        />
      </form>
      <CalendarMeetChannelEmailDialog
        open={collisionOpen}
        labels={labels}
        busy={busy || collisionBusy}
        contentClassName={collisionContentClassName}
        onOpenChange={(next) => {
          if (!next) cancelCollision();
        }}
        onChoice={(choice) => {
          void applyChoice(choice);
        }}
      />
    </>
  );
}
