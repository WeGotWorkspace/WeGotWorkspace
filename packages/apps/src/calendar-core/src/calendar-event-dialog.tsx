import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock, Repeat } from "lucide-react";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Switch } from "@/ui/switch";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  sessionEventInviteeStatus,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { CalendarAlarmsCard } from "@/calendar-core/src/calendar-alarms-card";
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

export type CalendarEventDialogLayout = {
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

export type CalendarEventDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  form: CalendarEventFormValue;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  /** BCP 47 tag; defaults to the same resolver the Lit calendar surface uses. */
  locale?: string;
  busy?: boolean;
  title?: string;
  submitLabel?: string;
  /** Rendered after the Meet card, before When (e.g. Meet Schedule switch). */
  afterMeetAccessory?: ReactNode;
  contentClassName?: string;
  layout?: CalendarEventDialogLayout;
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
  onRecurrenceSaveScopeChange?: (scope: RecurrenceEditScope) => void;
  onJoinMeeting?: (href: string) => void;
  invitees?: CalendarInvitee[];
  contactCards?: ContactCard[];
  onRefreshContactCards?: () => void;
  canSubmitEmail?: boolean;
  sessionEmail?: string;
  onRsvp?: (status: CalendarSchedulingRespondStatus, calendarId?: string) => void | Promise<void>;
};

function isoToJsDate(iso: string): Date | undefined {
  try {
    const plain = Temporal.PlainDate.from(iso);
    return new Date(plain.year, plain.month - 1, plain.day);
  } catch {
    return undefined;
  }
}

function jsDateToIso(date: Date): string {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }).toString();
}

function formatDateLabel(iso: string, locale: string): string {
  try {
    return Temporal.PlainDate.from(iso).toLocaleString(locale, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function LocaleDatePicker({
  value,
  locale,
  label,
  onChange,
  disabled = false,
}: {
  value: string;
  locale: string;
  label: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToJsDate(value);

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="calendar-event-dialog__date-trigger"
          aria-label={`${label}: ${formatDateLabel(value, locale)}`}
          lang={locale}
          disabled={disabled}
        >
          {formatDateLabel(value, locale)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="calendar-event-dialog__date-popover w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(jsDateToIso(date));
            setOpen(false);
          }}
          formatters={{
            formatCaption: (date) =>
              date.toLocaleString(locale, { month: "long", year: "numeric" }),
            formatWeekdayName: (date) => date.toLocaleString(locale, { weekday: "short" }),
            formatMonthDropdown: (date) => date.toLocaleString(locale, { month: "short" }),
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export function CalendarEventDialog({
  open,
  mode,
  form,
  calendars,
  labels,
  locale: localeProp,
  busy = false,
  title,
  submitLabel,
  afterMeetAccessory,
  contentClassName = "calendar-dialog-surface calendar-event-dialog",
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
  onRecurrenceSaveScopeChange,
  onJoinMeeting,
}: CalendarEventDialogProps) {
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
  const [uncontrolledMeetScope, setUncontrolledMeetScope] =
    useState<RecurrenceEditScope>("thisAndFuture");
  const abandonStagedReserveRef = useRef<(() => void) | null>(null);
  const meetSaveScope = thisInstanceLocked
    ? "thisInstance"
    : (recurrenceSaveScope ?? uncontrolledMeetScope);

  const dismiss = () => {
    abandonStagedReserveRef.current?.();
    onClose();
  };

  useEffect(() => {
    setDraftCalendarId(form.calendarId);
    setDraftRsvp(incomingRsvp ?? "");
  }, [form.calendarId, incomingRsvp, open]);

  useEffect(() => {
    if (!open) return;
    setUncontrolledMeetScope(thisInstanceLocked ? "thisInstance" : "thisAndFuture");
  }, [open, recurrenceId, thisInstanceLocked]);

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
    open,
    workspaceOrigin,
    meetOperations,
    calendar,
    username: sessionUsername,
    recurrenceId,
    recurrenceSaveScope: meetSaveScope,
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && dismiss()}>
      <DialogContent className={contentClassName} lang={locale} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {title ?? (mode === "create" ? labels.createEventTitle : labels.editEventTitle)}
          </DialogTitle>
        </DialogHeader>
        <form
          className="calendar-event-dialog__form"
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
            trySave(form.meetingUrl.trim() || form.meetRoomCode ? meetSaveScope : undefined);
          }}
        >
          <div className="calendar-event-dialog__fields">
            <NameColorRow className="calendar-event-dialog__title-row">
              <Input
                className={NAME_COLOR_ROW_INPUT_CLASS}
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder={labels.eventTitleLabel}
                aria-label={labels.eventTitleLabel}
                disabled={fieldsDisabled}
                autoFocus={!readOnly}
              />
              {layout?.hideCalendarPicker ? null : (
                <CalendarEventCalendarPicker
                  calendars={calendars}
                  calendarId={showInviteeRsvp ? draftCalendarId : form.calendarId}
                  labels={labels}
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

            {layout?.hideLocation ? null : (
              <FieldLabelRow label={labels.eventLocationLabel}>
                <Input
                  value={form.location}
                  onChange={(event) => set("location", event.target.value)}
                  placeholder={labels.eventLocationLabel}
                  disabled={fieldsDisabled}
                />
              </FieldLabelRow>
            )}

            <CalendarMeetCard
              form={form}
              labels={labels}
              calendar={calendar}
              username={sessionUsername}
              workspaceOrigin={workspaceOrigin}
              recurrenceId={recurrenceId}
              recurrenceSaveScope={meetSaveScope}
              thisInstanceLocked={thisInstanceLocked}
              meetOperations={meetOperations}
              disabled={fieldsDisabled}
              readOnly={readOnly}
              copyOnly={layout?.meetCopyOnly}
              emailGuestHint={
                showEmailGuestHint ? labels.eventMeetEmailGuestsNoAccessHint : undefined
              }
              onChange={commitForm}
              abandonStagedReserveRef={abandonStagedReserveRef}
              onRecurrenceSaveScopeChange={onRecurrenceSaveScopeChange ?? setUncontrolledMeetScope}
              onJoin={onJoinMeeting}
            />

            {afterMeetAccessory}

            {layout?.hideWhen ? null : (
              <Card
                className="calendar-event-dialog__card"
                titleIcon={<Clock className="size-4" />}
                title={labels.eventWhenSectionTitle}
              >
                <CardRow title={labels.eventAllDayLabel}>
                  <Switch
                    checked={form.allDay}
                    onCheckedChange={(checked) => set("allDay", checked === true)}
                    aria-label={labels.eventAllDayLabel}
                    disabled={fieldsDisabled}
                  />
                </CardRow>
                <CardRow title={labels.eventStartLabel}>
                  <div className="calendar-event-dialog__datetime">
                    <LocaleDatePicker
                      value={form.startDate}
                      locale={locale}
                      label={labels.eventStartLabel}
                      onChange={(next) => set("startDate", next)}
                      disabled={fieldsDisabled}
                    />
                    {!form.allDay ? (
                      <Input
                        type="time"
                        lang={locale}
                        value={form.startTime}
                        aria-label={`${labels.eventStartLabel} time`}
                        disabled={fieldsDisabled}
                        onChange={(event) => set("startTime", event.target.value)}
                      />
                    ) : null}
                  </div>
                </CardRow>
                <CardRow title={labels.eventEndLabel}>
                  <div className="calendar-event-dialog__datetime">
                    <LocaleDatePicker
                      value={form.endDate}
                      locale={locale}
                      label={labels.eventEndLabel}
                      onChange={(next) => set("endDate", next)}
                      disabled={fieldsDisabled}
                    />
                    {!form.allDay ? (
                      <Input
                        type="time"
                        lang={locale}
                        value={form.endTime}
                        aria-label={`${labels.eventEndLabel} time`}
                        disabled={fieldsDisabled}
                        onChange={(event) => set("endTime", event.target.value)}
                      />
                    ) : null}
                  </div>
                </CardRow>
                {!form.allDay ? (
                  <CardRow title={labels.eventTimeZoneLabel}>
                    <Select
                      value={eventTimeZoneSelectValue(form.timeZone)}
                      onValueChange={(value) =>
                        set("timeZone", eventTimeZoneFromSelectValue(value))
                      }
                      disabled={fieldsDisabled}
                    >
                      <SelectTrigger
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
                  </CardRow>
                ) : null}
              </Card>
            )}

            {layout?.hideRecurrence ? null : (
              <Card
                className="calendar-event-dialog__card"
                titleIcon={<Repeat className="size-4" />}
                title={labels.eventRepeatLabel}
              >
                <CardRow fill>
                  <Select
                    value={form.recurrencePreset}
                    onValueChange={(value) =>
                      setRecurrencePreset(value as EditableRecurrencePresetId)
                    }
                    disabled={recurrenceLocked || fieldsDisabled}
                  >
                    <SelectTrigger
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
                </CardRow>
                {showRecurrenceEnds ? (
                  <CardRow title={labels.eventRecurrenceEndsLabel}>
                    <div className="calendar-event-dialog__recurrence-ends">
                      <Select
                        value={form.recurrenceEnds}
                        onValueChange={(value) =>
                          set("recurrenceEnds", value as RecurrenceEndsMode)
                        }
                        disabled={fieldsDisabled}
                      >
                        <SelectTrigger aria-label={labels.eventRecurrenceEndsLabel}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="never">{labels.eventRecurrenceEndsNever}</SelectItem>
                          <SelectItem value="until">{labels.eventRecurrenceEndsOnDate}</SelectItem>
                          <SelectItem value="count">{labels.eventRecurrenceEndsAfter}</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="calendar-event-dialog__recurrence-ends-extra">
                        {form.recurrenceEnds !== "count" ? (
                          <LocaleDatePicker
                            value={form.recurrenceUntilDate || form.startDate}
                            locale={locale}
                            label={labels.eventRecurrenceEndsOnDate}
                            onChange={(next) => set("recurrenceUntilDate", next)}
                            disabled={form.recurrenceEnds !== "until" || fieldsDisabled}
                          />
                        ) : null}
                        {form.recurrenceEnds === "count" ? (
                          <div className="calendar-event-dialog__recurrence-count">
                            <Input
                              type="number"
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
                        ) : null}
                      </div>
                    </div>
                  </CardRow>
                ) : null}
              </Card>
            )}

            {layout?.hideInvitees ? null : (
              <CalendarInviteesCard
                attendees={form.attendees}
                invitees={invitees}
                contactCards={contactCards}
                onRefreshContactCards={onRefreshContactCards}
                labels={labels}
                busy={busy}
                readOnly={readOnly}
                canSubmitEmail={canSubmitEmail}
                sessionEmail={sessionEmail}
                meetEmailGuestHint={
                  showEmailGuestHint ? labels.eventMeetEmailGuestsNoAccessHint : undefined
                }
                onChange={(attendees) => set("attendees", attendees)}
              />
            )}

            {layout?.hideAlarms ? null : (
              <CalendarAlarmsCard
                alerts={form.alerts}
                labels={labels}
                disabled={fieldsDisabled}
                readOnly={readOnly}
                onChange={(alerts) => set("alerts", alerts)}
              />
            )}

            {layout?.hideShowAs ? null : (
              <FieldLabelRow label={labels.eventShowAs}>
                <Select
                  value={form.freeBusyStatus}
                  onValueChange={(value) => set("freeBusyStatus", value as CalendarFreeBusyStatus)}
                  disabled={fieldsDisabled}
                >
                  <SelectTrigger
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

            {layout?.hideNotes ? null : (
              <FieldLabelRow label={labels.eventNotesLabel}>
                <Textarea
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder={labels.eventNotesLabel}
                  disabled={fieldsDisabled}
                  rows={3}
                />
              </FieldLabelRow>
            )}
          </div>

          <DialogFooter className="calendar-event-dialog__footer">
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
              <Button
                type="button"
                variant="ghost"
                className="calendar-event-dialog__delete"
                onClick={onDelete}
                disabled={busy}
              >
                {labels.delete}
              </Button>
            ) : null}
            {showSaveCancel ? (
              <Button type="button" variant="outline" onClick={dismiss} disabled={busy}>
                {labels.cancel}
              </Button>
            ) : null}
            {showSaveCancel ? (
              <Button
                type="submit"
                disabled={
                  showInviteeRsvp ? !draftRsvp || busy : !valid || busy || canSubmit === false
                }
              >
                {submitLabel ?? labels.save}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
      <CalendarMeetChannelEmailDialog
        open={collisionOpen}
        labels={labels}
        busy={busy || collisionBusy}
        contentClassName={contentClassName}
        onOpenChange={(next) => {
          if (!next) cancelCollision();
        }}
        onChoice={(choice) => {
          void applyChoice(choice);
        }}
      />
    </Dialog>
  );
}
