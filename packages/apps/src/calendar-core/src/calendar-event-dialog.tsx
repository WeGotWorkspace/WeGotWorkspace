import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import { Button } from "@/button/src/button";
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
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventFormIsValid,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import {
  EDITABLE_RECURRENCE_PRESET_IDS,
  recurrencePresetOptionLabel,
  type EditableRecurrencePresetId,
  type RecurrencePresetId,
} from "@/calendar-core/src/calendar-recurrence-presets";

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
}: {
  value: string;
  locale: string;
  label: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToJsDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="calendar-event-dialog__date-trigger"
          aria-label={`${label}: ${formatDateLabel(value, locale)}`}
          lang={locale}
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
  onChange,
  onClose,
  onSave,
  onDelete,
}: CalendarEventDialogProps) {
  const locale = useMemo(() => resolveLocale(localeProp), [localeProp]);
  const writableCalendars = calendars.filter((calendar) => calendar.mayWrite !== false);
  const selectedCalendar =
    writableCalendars.find((calendar) => calendar.id === form.calendarId) ?? writableCalendars[0];
  const valid = calendarEventFormIsValid(form);
  const recurrenceLocked = form.recurrencePreset === "custom";
  const recurrenceOptions = useMemo(() => {
    const ids: RecurrencePresetId[] = recurrenceLocked
      ? ["custom"]
      : EDITABLE_RECURRENCE_PRESET_IDS;
    return ids.map((id) => ({
      id,
      label: recurrencePresetOptionLabel(id, form.startDate, locale),
    }));
  }, [form.startDate, locale, recurrenceLocked]);

  const set = <K extends keyof CalendarEventFormValue>(
    key: K,
    value: CalendarEventFormValue[K],
  ) => {
    onChange({ ...form, [key]: value });
  };

  const setRecurrencePreset = (preset: EditableRecurrencePresetId) => {
    onChange({
      ...form,
      recurrencePreset: preset,
      customRecurrenceRules: undefined,
    });
  };

  /** Portaled DropdownMenu/Popover layers sit outside DialogContent in the DOM. */
  const keepOpenForPortaledLayer = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest("[data-radix-popper-content-wrapper]")) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className="calendar-dialog-surface calendar-event-dialog"
        lang={locale}
        aria-describedby={undefined}
        onPointerDownOutside={keepOpenForPortaledLayer}
        onInteractOutside={keepOpenForPortaledLayer}
        onFocusOutside={keepOpenForPortaledLayer}
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
                  <button
                    type="button"
                    className="control-surface calendar-event-dialog__calendar-trigger"
                    aria-label={
                      selectedCalendar
                        ? `${labels.eventCalendarLabel}: ${selectedCalendar.name}`
                        : labels.eventCalendarLabel
                    }
                  >
                    <span
                      className="calendar-sidebar-dot"
                      style={{ backgroundColor: selectedCalendar?.color ?? "transparent" }}
                      aria-hidden
                    />
                  </button>
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

            <FieldLabelRow label={labels.eventAllDayLabel}>
              <Switch
                checked={form.allDay}
                onCheckedChange={(checked) => set("allDay", checked === true)}
                aria-label={labels.eventAllDayLabel}
              />
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventStartLabel}>
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
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventEndLabel}>
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
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventRepeatLabel}>
              <Select
                value={form.recurrencePreset}
                onValueChange={(value) => setRecurrencePreset(value as EditableRecurrencePresetId)}
                disabled={recurrenceLocked || busy}
              >
                <SelectTrigger aria-label={labels.eventRepeatLabel}>
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
