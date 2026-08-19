import { useMemo, useState } from "react";
import { Bell, Check, Clock, Repeat, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Switch } from "@/ui/switch";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventFormIsValid,
  patchCalendarEventForm,
  type CalendarEventFormValue,
  type RecurrenceEndsMode,
} from "@/calendar-core/src/calendar-editor-model";
import {
  defaultEventAlert,
  formatCustomOffset,
  matchAlertOffsetPreset,
  parseCustomOffset,
  presetToOffset,
  type CalendarAlertCustomUnit,
  type CalendarAlertOffsetPreset,
  type CalendarEventAlertFormValue,
  type CalendarFreeBusyStatus,
} from "@/calendar-core/src/calendar-alerts";
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
import { CalendarColorSwatchTrigger } from "@/calendar-core/src/calendar-color-swatch-trigger";

export type CalendarEventDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  form: CalendarEventFormValue;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  /** BCP 47 tag; defaults to the same resolver the Lit calendar surface uses. */
  locale?: string;
  busy?: boolean;
  onChange: (next: CalendarEventFormValue) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  invitees?: CalendarInvitee[];
  canSubmitEmail?: boolean;
  sessionEmail?: string;
  onRsvp?: (status: CalendarSchedulingRespondStatus) => void;
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

function alarmOffsetSelectValue(alert: CalendarEventAlertFormValue): CalendarAlertOffsetPreset {
  if (alert.offset == null) return "custom";
  return matchAlertOffsetPreset(alert.offset);
}

function AlarmRow({
  alert,
  labels,
  disabled,
  onChange,
  onRemove,
}: {
  alert: CalendarEventAlertFormValue;
  labels: CalendarUILabels;
  disabled: boolean;
  onChange: (patch: Partial<CalendarEventAlertFormValue>) => void;
  onRemove: () => void;
}) {
  const preset = alarmOffsetSelectValue(alert);
  const custom = alert.offset
    ? parseCustomOffset(alert.offset)
    : { amount: 15, unit: "minutes" as const };
  const isAbsolute = alert.offset == null && Boolean(alert.when);

  return (
    <div className="calendar-event-dialog__alarm-row">
      <Select
        value={isAbsolute ? "custom" : preset}
        onValueChange={(value) => {
          const next = value as CalendarAlertOffsetPreset;
          if (next === "custom") {
            onChange({
              offset: alert.offset ?? "-PT15M",
              when: undefined,
            });
            return;
          }
          onChange({ offset: presetToOffset(next), when: undefined });
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className="calendar-event-dialog__alarm-offset"
          aria-label={labels.eventAlarmsLabel}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="at-start">{labels.eventAlarmAtStart}</SelectItem>
          <SelectItem value="5m">{labels.eventAlarm5Min}</SelectItem>
          <SelectItem value="10m">{labels.eventAlarm10Min}</SelectItem>
          <SelectItem value="15m">{labels.eventAlarm15Min}</SelectItem>
          <SelectItem value="30m">{labels.eventAlarm30Min}</SelectItem>
          <SelectItem value="1h">{labels.eventAlarm1Hour}</SelectItem>
          <SelectItem value="1d">{labels.eventAlarm1Day}</SelectItem>
          <SelectItem value="custom">{labels.eventAlarmCustom}</SelectItem>
        </SelectContent>
      </Select>
      {isAbsolute ? (
        <Input
          type="datetime-local"
          className="calendar-event-dialog__alarm-when"
          value={alert.when?.slice(0, 16) ?? ""}
          aria-label={labels.eventAlarmCustom}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            onChange({ offset: null, when: `${value}:00` });
          }}
        />
      ) : null}
      {preset === "custom" && !isAbsolute ? (
        <div className="calendar-event-dialog__alarm-custom">
          <Input
            type="number"
            min={1}
            step={1}
            value={custom.amount}
            aria-label={labels.eventAlarmCustomAmount}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({
                offset: formatCustomOffset(Number.isFinite(parsed) ? parsed : 1, custom.unit),
                when: undefined,
              });
            }}
          />
          <Select
            value={custom.unit}
            onValueChange={(value) =>
              onChange({
                offset: formatCustomOffset(custom.amount, value as CalendarAlertCustomUnit),
                when: undefined,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger aria-label={labels.eventAlarmCustomAmount}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">{labels.eventAlarmUnitMinutes}</SelectItem>
              <SelectItem value="hours">{labels.eventAlarmUnitHours}</SelectItem>
              <SelectItem value="days">{labels.eventAlarmUnitDays}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        showTooltip={false}
        label={labels.eventAlarmRemove}
        icon={<Trash2 className="size-4" />}
        disabled={disabled}
        onClick={onRemove}
      />
    </div>
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
  onChange,
  onClose,
  onSave,
  onDelete,
  invitees = [],
  canSubmitEmail = true,
  sessionEmail,
  onRsvp,
}: CalendarEventDialogProps) {
  const locale = useMemo(() => resolveLocale(localeProp), [localeProp]);
  const writableCalendars = calendars.filter((calendar) => calendar.mayWrite !== false);
  const selectedCalendar =
    writableCalendars.find((calendar) => calendar.id === form.calendarId) ?? writableCalendars[0];
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

  const set = <K extends keyof CalendarEventFormValue>(
    key: K,
    value: CalendarEventFormValue[K],
  ) => {
    onChange(patchCalendarEventForm(form, { [key]: value } as Partial<CalendarEventFormValue>));
  };

  const setRecurrencePreset = (preset: EditableRecurrencePresetId) => {
    onChange(
      patchCalendarEventForm(form, {
        recurrencePreset: preset,
        customRecurrenceRules: undefined,
      }),
    );
  };

  const setAlerts = (alerts: CalendarEventAlertFormValue[]) => {
    onChange(patchCalendarEventForm(form, { alerts }));
  };

  const updateAlert = (id: string, patch: Partial<CalendarEventAlertFormValue>) => {
    setAlerts(form.alerts.map((alert) => (alert.id === id ? { ...alert, ...patch } : alert)));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className="calendar-dialog-surface calendar-event-dialog"
        lang={locale}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? labels.createEventTitle : labels.editEventTitle}
          </DialogTitle>
        </DialogHeader>
        <form
          className="calendar-event-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) onSave();
          }}
        >
          <div className="calendar-event-dialog__fields">
            <div className="calendar-event-dialog__title-row">
              <Input
                className="calendar-event-dialog__title-input"
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder={labels.eventTitleLabel}
                aria-label={labels.eventTitleLabel}
                autoFocus
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <CalendarColorSwatchTrigger
                    color={selectedCalendar?.color ?? "transparent"}
                    label={
                      selectedCalendar
                        ? `${labels.eventCalendarLabel}: ${selectedCalendar.name}`
                        : labels.eventCalendarLabel
                    }
                    className="calendar-event-dialog__calendar-trigger"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="calendar-event-dialog__calendar-menu">
                  {writableCalendars.map((calendar) => (
                    <DropdownMenuItem
                      key={calendar.id}
                      className="calendar-event-dialog__calendar-option"
                      onSelect={() => set("calendarId", calendar.id)}
                    >
                      <span
                        className="calendar-sidebar-dot"
                        style={{ backgroundColor: calendar.color }}
                        aria-hidden
                      />
                      <span className="calendar-event-dialog__calendar-name">{calendar.name}</span>
                      <Check
                        className={cn(
                          "calendar-event-dialog__calendar-check",
                          form.calendarId === calendar.id ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <FieldLabelRow label={labels.eventLocationLabel}>
              <Input
                value={form.location}
                onChange={(event) => set("location", event.target.value)}
                placeholder={labels.eventLocationLabel}
              />
            </FieldLabelRow>

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
                />
              </CardRow>
              <CardRow title={labels.eventStartLabel}>
                <div className="calendar-event-dialog__datetime">
                  <LocaleDatePicker
                    value={form.startDate}
                    locale={locale}
                    label={labels.eventStartLabel}
                    onChange={(next) => set("startDate", next)}
                  />
                  {!form.allDay ? (
                    <Input
                      type="time"
                      lang={locale}
                      value={form.startTime}
                      aria-label={`${labels.eventStartLabel} time`}
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
                  />
                  {!form.allDay ? (
                    <Input
                      type="time"
                      lang={locale}
                      value={form.endTime}
                      aria-label={`${labels.eventEndLabel} time`}
                      onChange={(event) => set("endTime", event.target.value)}
                    />
                  ) : null}
                </div>
              </CardRow>
              {!form.allDay ? (
                <CardRow title={labels.eventTimeZoneLabel}>
                  <Select
                    value={eventTimeZoneSelectValue(form.timeZone)}
                    onValueChange={(value) => set("timeZone", eventTimeZoneFromSelectValue(value))}
                    disabled={busy}
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
                  disabled={recurrenceLocked || busy}
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
                      onValueChange={(value) => set("recurrenceEnds", value as RecurrenceEndsMode)}
                      disabled={busy}
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
                          disabled={form.recurrenceEnds !== "until" || busy}
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

            <CalendarInviteesCard
              attendees={form.attendees}
              invitees={invitees}
              labels={labels}
              busy={busy}
              canSubmitEmail={canSubmitEmail}
              sessionEmail={sessionEmail}
              onChange={(attendees) => set("attendees", attendees)}
            />

            <Card
              className="calendar-event-dialog__card"
              titleIcon={<Bell className="size-4" />}
              title={labels.eventAlarmsLabel}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setAlerts([...form.alerts, defaultEventAlert(form.alerts)])}
                >
                  {labels.eventAlarmAdd}
                </Button>
              }
            >
              {form.alerts.length === 0 ? (
                <CardRow title={labels.eventAlarmsNone} />
              ) : (
                form.alerts.map((alert) => (
                  <CardRow key={alert.id} fill>
                    <AlarmRow
                      alert={alert}
                      labels={labels}
                      disabled={busy}
                      onChange={(patch) => updateAlert(alert.id, patch)}
                      onRemove={() => setAlerts(form.alerts.filter((row) => row.id !== alert.id))}
                    />
                  </CardRow>
                ))
              )}
            </Card>

            <FieldLabelRow label={labels.eventShowAs}>
              <Select
                value={form.freeBusyStatus}
                onValueChange={(value) => set("freeBusyStatus", value as CalendarFreeBusyStatus)}
                disabled={busy}
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

            <FieldLabelRow label={labels.eventNotesLabel}>
              <Textarea
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder={labels.eventNotesLabel}
                rows={3}
              />
            </FieldLabelRow>
          </div>

          <DialogFooter className="calendar-event-dialog__footer">
            {mode === "edit" && onRsvp && sessionEmail ? (
              form.attendees.some(
                (row) => row.email === sessionEmail.toLowerCase() && !row.isOrganizer,
              ) ? (
                <>
                  <Button
                    type="button"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => onRsvp("accepted")}
                  >
                    {labels.rsvpAccept}
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => onRsvp("tentative")}
                  >
                    {labels.rsvpMaybe}
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => onRsvp("declined")}
                  >
                    {labels.rsvpDecline}
                  </Button>
                </>
              ) : null
            ) : null}
            {mode === "edit" && onDelete ? (
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
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
