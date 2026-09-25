import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, CircleDot, Link2, MapPin, StickyNote, Type, Users } from "lucide-react";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import { FieldLabelRow } from "@/ui/field-label-row";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  sessionEventInviteeStatus,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { CalendarAlarmsRows } from "@/calendar-core/src/calendar-alarms-card";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
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
import { type CalendarFreeBusyStatus } from "@/calendar-core/src/calendar-alerts";
import { CalendarEventCalendarPicker } from "@/calendar-core/src/calendar-event-calendar-picker";
import { CalendarEventFormRecurrence } from "@/calendar-core/src/calendar-event-form-recurrence";
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
          <FieldLabelRow
            className="calendar-event-dialog__field calendar-event-dialog__field--title"
            label={labels.eventTitleLabel}
            labelMode="icon"
            icon={fieldIcon(<Type className="size-3.5" aria-hidden />)}
          >
            <NameColorRow className="calendar-event-dialog__title-row">
              <Input
                className={NAME_COLOR_ROW_INPUT_CLASS}
                size={controlSize}
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder={labels.eventTitleLabel}
                aria-label={labels.eventTitleLabel}
                disabled={fieldsDisabled}
                autoFocus={autoFocusTitle && !readOnly}
              />
              {layout?.hideCalendarPicker ? null : (
                <CalendarEventCalendarPicker
                  calendars={calendars}
                  calendarId={calendarPickerInteractive ? draftCalendarId : form.calendarId}
                  labels={labels}
                  size={controlSize}
                  disabled={busy || (readOnly && !calendarPickerInteractive)}
                  onCalendarIdChange={(calendarId) => {
                    if (showInviteeRsvp) {
                      setDraftCalendarId(calendarId);
                      return;
                    }
                    if (invitationMode) {
                      if (busy || calendarId === draftCalendarId) return;
                      const previous = draftCalendarId;
                      setDraftCalendarId(calendarId);
                      // needs-action / declined: keep local until Accept/Maybe (Decline ignores calendarId).
                      const persisted = incomingRsvp;
                      if (!persisted || persisted === "declined") return;
                      void Promise.resolve(onRsvp?.(persisted, calendarId || undefined)).catch(
                        () => {
                          setDraftCalendarId(previous);
                        },
                      );
                      return;
                    }
                    set("calendarId", calendarId);
                  }}
                />
              )}
            </NameColorRow>
          </FieldLabelRow>

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
            <FieldLabelRow
              className="calendar-event-dialog__field calendar-event-dialog__field--availability"
              label={labels.eventShowAs}
              labelMode="icon"
              icon={fieldIcon(<CircleDot className="size-3.5" aria-hidden />)}
            >
              <Select
                value={form.freeBusyStatus}
                onValueChange={(value) => set("freeBusyStatus", value as CalendarFreeBusyStatus)}
                disabled={fieldsDisabled}
              >
                <SelectTrigger
                  size={controlSize}
                  className="calendar-event-dialog__show-as-trigger"
                  aria-label={labels.eventShowAs}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="busy">{labels.eventShowAsBusy}</SelectItem>
                  <SelectItem value="free">{labels.eventShowAsFree}</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabelRow>
          )}

          <div className="calendar-event-dialog__secondary">
            <div className="calendar-event-dialog__secondary-start">
              {layout?.hideInvitees ? null : (
                <CalendarInviteesCard
                  className="calendar-event-dialog__field calendar-event-dialog__field--invitees"
                  presentation="field"
                  fieldIcon={fieldIcon(<Users className="size-3.5" aria-hidden />)}
                  attendees={form.attendees}
                  invitees={invitees}
                  contactCards={contactCards}
                  onRefreshContactCards={onRefreshContactCards}
                  labels={labels}
                  busy={busy}
                  readOnly={readOnly}
                  canSubmitEmail={canSubmitEmail}
                  sessionEmail={sessionEmail}
                  controlSize={controlSize}
                  meetEmailGuestHint={
                    showEmailGuestHint ? labels.eventMeetEmailGuestsNoAccessHint : undefined
                  }
                  onChange={(attendees) => set("attendees", attendees)}
                />
              )}
            </div>

            <div className="calendar-event-dialog__secondary-end">
              {layout?.hideAlarms ? null : (
                <FieldLabelRow
                  className="calendar-event-dialog__field calendar-event-dialog__field--alarms"
                  label={labels.eventAlarmsLabel}
                  labelMode="icon"
                  icon={fieldIcon(<Bell className="size-3.5" aria-hidden />)}
                >
                  <div className="calendar-event-dialog__alarms-field">
                    <CalendarAlarmsRows
                      alerts={form.alerts}
                      labels={labels}
                      disabled={fieldsDisabled}
                      readOnly={readOnly}
                      controlSize={controlSize}
                      onChange={(alerts) => set("alerts", alerts)}
                    />
                  </div>
                </FieldLabelRow>
              )}

              {layout?.hideNotes ? null : (
                <FieldLabelRow
                  className="calendar-event-dialog__field calendar-event-dialog__field--notes"
                  label={labels.eventNotesLabel}
                  labelMode="icon"
                  icon={fieldIcon(<StickyNote className="size-3.5" aria-hidden />)}
                >
                  <Textarea
                    size={controlSize}
                    value={form.description}
                    onChange={(event) => set("description", event.target.value)}
                    placeholder={labels.eventNotesLabel}
                    aria-label={labels.eventNotesLabel}
                    disabled={fieldsDisabled}
                    rows={3}
                  />
                </FieldLabelRow>
              )}
            </div>
          </div>
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
