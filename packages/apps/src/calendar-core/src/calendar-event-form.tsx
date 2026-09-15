import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  CircleDot,
  Globe,
  Link2,
  MapPin,
  Repeat,
  StickyNote,
  Sun,
  Trash2,
  Type,
  Users,
} from "lucide-react";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import { Button, IconButton } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { Input } from "@/ui/input";
import { LocaleDatePicker } from "@/ui/locale-date-picker";
import { Textarea } from "@/ui/textarea";
import { Switch } from "@/ui/switch";
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
import {
  calendarRespondStatus,
  CalendarRsvpSelect,
} from "@/calendar-core/src/calendar-rsvp-actions";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventFormIsValid,
  patchCalendarEventForm,
  type CalendarEventFormValue,
  type RecurrenceEndsMode,
} from "@/calendar-core/src/calendar-editor-model";
import { type CalendarFreeBusyStatus } from "@/calendar-core/src/calendar-alerts";
import {
  EDITABLE_RECURRENCE_PRESET_IDS,
  recurrencePresetOptionLabel,
  type EditableRecurrencePresetId,
  type RecurrencePresetId,
} from "@/calendar-core/src/calendar-recurrence-presets";
import {
  eventTimeZoneFromSelectValue,
  eventTimeZoneOptions,
  eventTimeZoneSelectValue,
} from "@/calendar-core/src/calendar-timezones";
import { CalendarEventCalendarPicker } from "@/calendar-core/src/calendar-event-calendar-picker";
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
  mode: "create" | "edit";
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
  onRsvp?: (status: CalendarSchedulingRespondStatus, calendarId?: string) => void | Promise<void>;
  /** Collision dialog surface class (defaults to calendar dialog surface). */
  collisionContentClassName?: string;
  /** When false, skip autofocus on the title (popover hosts focus on the shell). */
  autoFocusTitle?: boolean;
  /**
   * Shared control height for Inputs / Selects / LocaleDatePicker / buttons.
   * Interactive edit popover uses `sm`; create/edit dialog keeps default `md`.
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
  controlSize = "md",
}: CalendarEventFormProps) {
  const locale = useMemo(() => resolveLocale(localeProp), [localeProp]);
  const isOrganizer = isSessionEventOrganizer(form.attendees, sessionEmail, invitees);
  const isInvitee = isSessionEventInvitee(form.attendees, sessionEmail, invitees);
  const inviteeRsvp = sessionEventInviteeStatus(form.attendees, sessionEmail, invitees);
  const incomingRsvp = calendarRespondStatus(inviteeRsvp);
  const calendar = calendars.find((entry) => entry.id === form.calendarId);
  const readOnly = isCalendarEventFormReadOnly({ mode, calendar, isOrganizer });
  const fieldsDisabled = busy || readOnly;
  const showInviteeRsvp = mode === "edit" && Boolean(onRsvp) && isInvitee;
  const showSaveCancel = !readOnly || showInviteeRsvp;
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
  const recurrenceLocked = form.recurrencePreset === "custom";
  const showRecurrenceEnds = !recurrenceLocked && form.recurrencePreset !== "none";
  const recurrenceOptions = useMemo(() => {
    const ids: RecurrencePresetId[] = recurrenceLocked
      ? ["custom"]
      : EDITABLE_RECURRENCE_PRESET_IDS;
    return ids.map((id) => ({
      id,
      label: recurrencePresetOptionLabel(id, form.startDate, locale),
    }));
  }, [form.startDate, locale, recurrenceLocked]);

  const timeZoneOptions = useMemo(
    () => eventTimeZoneOptions(locale, labels.eventTimeZoneLocalLabel, form.timeZone),
    [form.timeZone, labels.eventTimeZoneLocalLabel, locale],
  );

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

  const setRecurrencePreset = (preset: EditableRecurrencePresetId) => {
    onChange(
      patchCalendarEventForm(form, {
        recurrencePreset: preset,
        customRecurrenceRules: undefined,
      }),
    );
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
                  calendarId={showInviteeRsvp ? draftCalendarId : form.calendarId}
                  labels={labels}
                  size={controlSize}
                  disabled={busy || (readOnly && !showInviteeRsvp)}
                  onCalendarIdChange={(calendarId) => {
                    if (showInviteeRsvp) {
                      setDraftCalendarId(calendarId);
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
              copyOnly={layout?.meetCopyOnly}
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
            <div className="calendar-event-dialog__field-group calendar-event-dialog__field-group--when">
              <FieldLabelRow
                className="calendar-event-dialog__field calendar-event-dialog__field--starts"
                label={labels.eventStartLabel}
                labelMode="icon"
                icon={fieldIcon(<CalendarDays className="size-3.5" aria-hidden />)}
              >
                <div className="calendar-event-dialog__datetime">
                  <LocaleDatePicker
                    value={form.startDate}
                    locale={locale}
                    size={controlSize}
                    label={labels.eventStartLabel}
                    onChange={(next) => set("startDate", next)}
                    disabled={fieldsDisabled}
                  />
                  <div
                    className="calendar-event-dialog__time-slot"
                    aria-hidden={form.allDay || undefined}
                  >
                    {!form.allDay ? (
                      <Input
                        type="time"
                        size={controlSize}
                        lang={locale}
                        value={form.startTime}
                        aria-label={`${labels.eventStartLabel} time`}
                        disabled={fieldsDisabled}
                        onChange={(event) => set("startTime", event.target.value)}
                      />
                    ) : null}
                  </div>
                </div>
              </FieldLabelRow>
              <FieldLabelRow
                className="calendar-event-dialog__field calendar-event-dialog__field--ends"
                label={labels.eventEndLabel}
                labelMode="icon"
                icon={fieldIcon(<CalendarDays className="size-3.5" aria-hidden />)}
              >
                <div className="calendar-event-dialog__datetime">
                  <LocaleDatePicker
                    value={form.endDate}
                    locale={locale}
                    size={controlSize}
                    label={labels.eventEndLabel}
                    onChange={(next) => set("endDate", next)}
                    disabled={fieldsDisabled}
                  />
                  <div
                    className="calendar-event-dialog__time-slot"
                    aria-hidden={form.allDay || undefined}
                  >
                    {!form.allDay ? (
                      <Input
                        type="time"
                        size={controlSize}
                        lang={locale}
                        value={form.endTime}
                        aria-label={`${labels.eventEndLabel} time`}
                        disabled={fieldsDisabled}
                        onChange={(event) => set("endTime", event.target.value)}
                      />
                    ) : null}
                  </div>
                </div>
              </FieldLabelRow>
              <div className="calendar-event-dialog__when-meta">
                <FieldLabelRow
                  className="calendar-event-dialog__field calendar-event-dialog__field--all-day"
                  label={labels.eventAllDayLabel}
                  labelMode="icon"
                  icon={fieldIcon(<Sun className="size-3.5" aria-hidden />)}
                >
                  <div className="calendar-event-dialog__all-day">
                    <Switch
                      checked={form.allDay}
                      onCheckedChange={(checked) => set("allDay", checked === true)}
                      aria-label={labels.eventAllDayLabel}
                      disabled={fieldsDisabled}
                    />
                    <span className="calendar-event-dialog__all-day-caption" aria-hidden>
                      {labels.eventAllDayLabel}
                    </span>
                  </div>
                </FieldLabelRow>
                {!form.allDay ? (
                  <FieldLabelRow
                    className="calendar-event-dialog__field calendar-event-dialog__field--timezone"
                    label={labels.eventTimeZoneLabel}
                    labelMode="icon"
                    icon={fieldIcon(<Globe className="size-3.5" aria-hidden />)}
                  >
                    <Select
                      value={eventTimeZoneSelectValue(form.timeZone)}
                      onValueChange={(value) =>
                        set("timeZone", eventTimeZoneFromSelectValue(value))
                      }
                      disabled={fieldsDisabled}
                    >
                      <SelectTrigger
                        size={controlSize}
                        className="calendar-event-dialog__timezone-trigger"
                        aria-label={labels.eventTimeZoneLabel}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timeZoneOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldLabelRow>
                ) : null}
              </div>
            </div>
          )}

          {layout?.hideRecurrence ? null : (
            <FieldLabelRow
              className="calendar-event-dialog__field calendar-event-dialog__field--repeat"
              label={labels.eventRepeatLabel}
              labelMode="icon"
              icon={fieldIcon(<Repeat className="size-3.5" aria-hidden />)}
            >
              <div className="calendar-event-dialog__repeat-stack">
                <Select
                  value={form.recurrencePreset}
                  onValueChange={(value) =>
                    setRecurrencePreset(value as EditableRecurrencePresetId)
                  }
                  disabled={recurrenceLocked || fieldsDisabled}
                >
                  <SelectTrigger
                    size={controlSize}
                    className="calendar-event-dialog__repeat-trigger"
                    aria-label={labels.eventRepeatLabel}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {recurrenceOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showRecurrenceEnds ? (
                  <div className="calendar-event-dialog__recurrence-ends">
                    <Select
                      value={form.recurrenceEnds}
                      onValueChange={(value) => set("recurrenceEnds", value as RecurrenceEndsMode)}
                      disabled={fieldsDisabled}
                    >
                      <SelectTrigger
                        size={controlSize}
                        aria-label={labels.eventRecurrenceEndsLabel}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">{labels.eventRecurrenceEndsNever}</SelectItem>
                        <SelectItem value="until">{labels.eventRecurrenceEndsOnDate}</SelectItem>
                        <SelectItem value="count">{labels.eventRecurrenceEndsAfter}</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.recurrenceEnds === "until" ? (
                      <div className="calendar-event-dialog__recurrence-ends-extra">
                        <LocaleDatePicker
                          value={form.recurrenceUntilDate || form.startDate}
                          locale={locale}
                          size={controlSize}
                          label={labels.eventRecurrenceEndsOnDate}
                          onChange={(next) => set("recurrenceUntilDate", next)}
                          disabled={fieldsDisabled}
                        />
                      </div>
                    ) : null}
                    {form.recurrenceEnds === "count" ? (
                      <div className="calendar-event-dialog__recurrence-ends-extra">
                        <div className="calendar-event-dialog__recurrence-count">
                          <Input
                            type="number"
                            size={controlSize}
                            min={1}
                            step={1}
                            value={form.recurrenceCount}
                            aria-label={labels.eventRecurrenceEndsAfter}
                            disabled={fieldsDisabled}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              set("recurrenceCount", Number.isFinite(parsed) ? parsed : 0);
                            }}
                          />
                          <span className="calendar-event-dialog__recurrence-count-suffix">
                            {labels.eventRecurrenceEndsCountSuffix}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </FieldLabelRow>
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

        <footer className="calendar-event-dialog__footer">
          {showInviteeRsvp ? (
            <CalendarRsvpSelect
              className="calendar-event-dialog__rsvp"
              value={draftRsvp}
              labels={labels}
              busy={busy}
              onChange={setDraftRsvp}
            />
          ) : null}
          {mode === "edit" && onDelete && !readOnly ? (
            <IconButton
              type="button"
              variant="outline"
              severity="danger"
              size={controlSize}
              className="calendar-event-dialog__delete"
              icon={<Trash2 className="size-3.5" aria-hidden />}
              label={labels.delete}
              onClick={onDelete}
              disabled={busy}
            />
          ) : null}
          {showSaveCancel ? (
            <div className="calendar-event-dialog__footer-end">
              <Button
                type="button"
                variant="outline"
                size={controlSize}
                label={labels.cancel}
                onClick={dismiss}
                disabled={busy}
              />
              <Button
                type="submit"
                size={controlSize}
                label={saveLabel}
                disabled={
                  showInviteeRsvp ? !draftRsvp || busy : !valid || busy || canSubmit === false
                }
              />
            </div>
          ) : null}
        </footer>
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
