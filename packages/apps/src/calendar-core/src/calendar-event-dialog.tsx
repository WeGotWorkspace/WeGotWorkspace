import { Button } from "@/button/src/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventFormIsValid,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";

export type CalendarEventDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  form: CalendarEventFormValue;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  busy?: boolean;
  onChange: (next: CalendarEventFormValue) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
};

export function CalendarEventDialog({
  open,
  mode,
  form,
  calendars,
  labels,
  busy = false,
  onChange,
  onClose,
  onSave,
  onDelete,
}: CalendarEventDialogProps) {
  const writableCalendars = calendars.filter((calendar) => calendar.mayWrite !== false);
  const valid = calendarEventFormIsValid(form);

  const set = <K extends keyof CalendarEventFormValue>(
    key: K,
    value: CalendarEventFormValue[K],
  ) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="calendar-dialog-surface calendar-event-dialog">
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
            <FieldLabelRow label={labels.eventTitleLabel}>
              <Input
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                autoFocus
              />
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventCalendarLabel}>
              <Select value={form.calendarId} onValueChange={(value) => set("calendarId", value)}>
                <SelectTrigger aria-label={labels.eventCalendarLabel}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {writableCalendars.map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      <span className="calendar-event-dialog__calendar-option">
                        <span
                          className="calendar-sidebar-dot"
                          style={{ backgroundColor: calendar.color }}
                          aria-hidden
                        />
                        {calendar.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => set("startDate", event.target.value)}
                />
                {!form.allDay ? (
                  <Input
                    type="time"
                    value={form.startTime}
                    onChange={(event) => set("startTime", event.target.value)}
                  />
                ) : null}
              </div>
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventEndLabel}>
              <div className="calendar-event-dialog__datetime">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(event) => set("endDate", event.target.value)}
                />
                {!form.allDay ? (
                  <Input
                    type="time"
                    value={form.endTime}
                    onChange={(event) => set("endTime", event.target.value)}
                  />
                ) : null}
              </div>
            </FieldLabelRow>

            <FieldLabelRow label={labels.eventLocationLabel}>
              <Input
                value={form.location}
                onChange={(event) => set("location", event.target.value)}
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
