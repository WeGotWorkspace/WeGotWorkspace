import { Bell, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import {
  alertsAfterOffsetChange,
  formatUnmatchedAlertOffset,
  isAlertOffsetSelectValue,
  matchAlertOffsetPreset,
  type CalendarAlertOffsetSelectValue,
  type CalendarEventAlertFormValue,
} from "@/lib/calendar/calendar-alerts";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import type { ControlSize } from "@/ui/control-size";
import "@/share-ui/share-ui.css";
import "@/alarms-card/src/alarms-card.css";

const EMPTY_SLOT_ID = null;

function foreignSelectValue(alert: CalendarEventAlertFormValue): string | null {
  if (alert.offset != null) {
    return matchAlertOffsetPreset(alert.offset) ? null : `offset:${alert.offset}`;
  }
  if (alert.when) return `when:${alert.when}`;
  return null;
}

/** The Select value for one alarm row; `"none"` for the empty trailing slot. */
export function alarmOffsetSelectValue(alert: CalendarEventAlertFormValue | null): string {
  if (!alert) return "none";
  if (alert.offset != null) {
    return matchAlertOffsetPreset(alert.offset) ?? `offset:${alert.offset}`;
  }
  if (alert.when) return `when:${alert.when}`;
  return "none";
}

function foreignSelectLabel(alert: CalendarEventAlertFormValue): string {
  if (alert.offset != null) return formatUnmatchedAlertOffset(alert.offset);
  return alert.when ?? "";
}

const ALARM_OFFSET_PRESETS = [
  ["at-start", "eventAlarmAtStart"],
  ["5m", "eventAlarm5Min"],
  ["10m", "eventAlarm10Min"],
  ["15m", "eventAlarm15Min"],
  ["30m", "eventAlarm30Min"],
  ["1h", "eventAlarm1Hour"],
  ["1d", "eventAlarm1Day"],
] as const satisfies ReadonlyArray<
  readonly [CalendarAlertOffsetSelectValue, keyof AlarmsCardLabels]
>;

/** What one alarm row shows: a preset name, a foreign offset or time, or None. */
export function alarmOffsetLabel(
  alert: CalendarEventAlertFormValue | null,
  labels: AlarmsCardLabels,
): string {
  const value = alarmOffsetSelectValue(alert);
  const preset = ALARM_OFFSET_PRESETS.find(([presetValue]) => presetValue === value);
  if (preset) return labels[preset[1]];
  if (value === "none" || !alert) return labels.eventAlarmNone;
  return foreignSelectLabel(alert);
}

/** The options of one alarm row's Select: None, a foreign value (read-only), the presets. */
export function AlarmOffsetMenuItems({
  alert,
  labels,
  itemClassName,
}: {
  alert: CalendarEventAlertFormValue | null;
  labels: AlarmsCardLabels;
  itemClassName?: string;
}) {
  const foreignValue = alert ? foreignSelectValue(alert) : null;
  return (
    <>
      <SelectItem value="none" className={itemClassName}>
        {labels.eventAlarmNone}
      </SelectItem>
      {foreignValue && alert ? (
        <SelectItem value={foreignValue} disabled className={itemClassName}>
          {foreignSelectLabel(alert)}
        </SelectItem>
      ) : null}
      {ALARM_OFFSET_PRESETS.map(([value, key]) => (
        <SelectItem key={value} value={value} className={itemClassName}>
          {labels[key]}
        </SelectItem>
      ))}
    </>
  );
}

function AlarmOffsetRow({
  alert,
  labels,
  disabled,
  controlSize = "sm",
  onSelect,
  onRemove,
}: {
  alert: CalendarEventAlertFormValue | null;
  labels: AlarmsCardLabels;
  disabled: boolean;
  controlSize?: ControlSize;
  onSelect: (value: CalendarAlertOffsetSelectValue) => void;
  onRemove?: () => void;
}) {
  const selectValue = alarmOffsetSelectValue(alert);

  return (
    <div className="calendar-event-dialog__alarm-row">
      <Select
        value={selectValue}
        onValueChange={(value) => {
          if (isAlertOffsetSelectValue(value)) onSelect(value);
        }}
        disabled={disabled}
      >
        <CollectionGhostSelectTrigger
          className="calendar-event-dialog__alarm-offset"
          aria-label={labels.eventAlarmOffset}
          label={<SelectValue />}
        />
        <SelectContent align="end">
          <AlarmOffsetMenuItems alert={alert} labels={labels} />
        </SelectContent>
      </Select>
      {onRemove ? (
        <IconButton
          className="calendar-event-dialog__alarm-remove"
          label={labels.eventAlarmRemove}
          icon={<Trash2 className="size-3.5" aria-hidden />}
          size={controlSize}
          variant="ghost"
          disabled={disabled}
          onClick={onRemove}
        />
      ) : null}
    </div>
  );
}

/** The alarm rows' labels. Calendar's labels carry the same keys. */
export type AlarmsCardLabels = {
  eventAlarmsLabel: string;
  eventAlarmRemove: string;
  eventAlarmOffset: string;
  eventAlarmNone: string;
  eventAlarmAtStart: string;
  eventAlarm5Min: string;
  eventAlarm10Min: string;
  eventAlarm15Min: string;
  eventAlarm30Min: string;
  eventAlarm1Hour: string;
  eventAlarm1Day: string;
};

/** Default alarm copy, shared by Calendar events and Tasks reminders (#2116). */
export const defaultAlarmsCardLabels: AlarmsCardLabels = {
  eventAlarmsLabel: "Alarms",
  eventAlarmRemove: "Remove alert",
  eventAlarmOffset: "Alert time",
  eventAlarmNone: "None",
  eventAlarmAtStart: "At time of event",
  eventAlarm5Min: "5 minutes before",
  eventAlarm10Min: "10 minutes before",
  eventAlarm15Min: "15 minutes before",
  eventAlarm30Min: "30 minutes before",
  eventAlarm1Hour: "1 hour before",
  eventAlarm1Day: "1 day before",
};

export type AlarmsCardProps = {
  alerts: CalendarEventAlertFormValue[];
  labels: AlarmsCardLabels;
  disabled?: boolean;
  readOnly?: boolean;
  /** Tasks persist due-relative offsets; calendar leaves this unset (event start). */
  defaultRelatedTo?: "start" | "end";
  /** Shared control height (`sm` in the compact event popover). Default `md`. */
  controlSize?: ControlSize;
  onChange: (alerts: CalendarEventAlertFormValue[]) => void;
};

export function AlarmsRows({
  alerts,
  labels,
  disabled = false,
  readOnly = false,
  defaultRelatedTo,
  controlSize = "sm",
  onChange,
}: AlarmsCardProps) {
  const showTrailingNone = !readOnly;
  const commitOffset = (rowId: string | null, value: CalendarAlertOffsetSelectValue) => {
    onChange(alertsAfterOffsetChange({ alerts, rowId, value, defaultRelatedTo }));
  };

  return (
    <>
      {alerts.map((alert) => (
        <AlarmOffsetRow
          key={alert.id}
          alert={alert}
          labels={labels}
          disabled={disabled || readOnly}
          controlSize={controlSize}
          onSelect={(value) => commitOffset(alert.id, value)}
          onRemove={
            readOnly ? undefined : () => onChange(alerts.filter((row) => row.id !== alert.id))
          }
        />
      ))}
      {showTrailingNone ? (
        <AlarmOffsetRow
          alert={null}
          labels={labels}
          disabled={disabled}
          controlSize={controlSize}
          onSelect={(value) => commitOffset(EMPTY_SLOT_ID, value)}
        />
      ) : null}
    </>
  );
}

export function AlarmsCard(props: AlarmsCardProps) {
  return (
    <ShareAccessCard
      icon={<Bell aria-hidden />}
      className="calendar-event-dialog__card calendar-alarms-card"
      title={props.labels.eventAlarmsLabel}
    >
      <AlarmsRows {...props} />
    </ShareAccessCard>
  );
}
