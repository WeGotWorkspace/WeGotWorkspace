import { Temporal } from "@js-temporal/polyfill";
import type { JSCalendarAlert, JSCalendarEvent } from "@/lib/jmap-client";

/** JSCalendar `freeBusyStatus` (RFC 8984 §4.4.2). Default is busy. */
export type CalendarFreeBusyStatus = "busy" | "free";

export const DEFAULT_FREE_BUSY_STATUS: CalendarFreeBusyStatus = "busy";

/** JSCalendar `Alert.action` this UI persists. Leftover `"email"` / `"audio"` map to display. */
export type CalendarAlertAction = "display";

export const DEFAULT_ALERT_ACTION: CalendarAlertAction = "display";

export type CalendarAlertOffsetPreset =
  | "at-start"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "1h"
  | "1d"
  | "custom";

/** Offset dropdown value, including the empty trailing slot. */
export type CalendarAlertOffsetSelectValue = CalendarAlertOffsetPreset | "none";

export type CalendarAlertCustomUnit = "minutes" | "hours" | "days";

export type CalendarEventAlertFormValue = {
  id: string;
  action: CalendarAlertAction;
  /** Signed ISO 8601 duration relative to start; null when the trigger is absolute. */
  offset: string | null;
  /** Absolute LocalDateTime / UTC when `offset` is null. */
  when?: string;
  /** Preserved when the wire used RELATED=END. */
  relatedTo?: "start" | "end";
};

export const ALERT_OFFSET_PRESETS: ReadonlyArray<{
  id: Exclude<CalendarAlertOffsetPreset, "custom">;
  offset: string;
}> = [
  { id: "at-start", offset: "PT0S" },
  { id: "5m", offset: "-PT5M" },
  { id: "10m", offset: "-PT10M" },
  { id: "15m", offset: "-PT15M" },
  { id: "30m", offset: "-PT30M" },
  { id: "1h", offset: "-PT1H" },
  { id: "1d", offset: "-P1D" },
];

const AT_START_OFFSETS = new Set(["PT0S", "-PT0S", "PT0M", "-PT0M", "P0D"]);

export function isFreeBusyStatus(value: unknown): value is CalendarFreeBusyStatus {
  return value === "busy" || value === "free";
}

/** RFC values only. Leftover `"tentative"` (and anything else) maps to busy. */
export function freeBusyStatusFromWire(value: unknown): CalendarFreeBusyStatus {
  return isFreeBusyStatus(value) ? value : DEFAULT_FREE_BUSY_STATUS;
}

/** This UI only persists display. Leftover `"email"` / `"audio"` (and anything else) map to display. */
export function alertActionFromWire(_value: unknown): CalendarAlertAction {
  return DEFAULT_ALERT_ACTION;
}

export function matchAlertOffsetPreset(offset: string): CalendarAlertOffsetPreset {
  if (AT_START_OFFSETS.has(offset)) return "at-start";
  const found = ALERT_OFFSET_PRESETS.find((preset) => preset.offset === offset);
  return found?.id ?? "custom";
}

export function presetToOffset(preset: Exclude<CalendarAlertOffsetPreset, "custom">): string {
  const found = ALERT_OFFSET_PRESETS.find((entry) => entry.id === preset);
  return found?.offset ?? "PT0S";
}

export function parseCustomOffset(offset: string): {
  amount: number;
  unit: CalendarAlertCustomUnit;
} {
  try {
    const duration = Temporal.Duration.from(offset.replace(/^-/, ""));
    if (
      duration.days > 0 &&
      duration.hours === 0 &&
      duration.minutes === 0 &&
      duration.seconds === 0
    ) {
      return { amount: duration.days, unit: "days" };
    }
    if (
      duration.hours > 0 &&
      duration.days === 0 &&
      duration.minutes === 0 &&
      duration.seconds === 0
    ) {
      return { amount: duration.hours, unit: "hours" };
    }
    const totalMinutes = Math.round(duration.total({ unit: "minutes" }));
    return { amount: totalMinutes > 0 ? totalMinutes : 15, unit: "minutes" };
  } catch {
    return { amount: 15, unit: "minutes" };
  }
}

export function formatCustomOffset(amount: number, unit: CalendarAlertCustomUnit): string {
  const safe = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
  return Temporal.Duration.from({ [unit]: safe })
    .negated()
    .toString();
}

export function defaultEventAlert(
  existing: CalendarEventAlertFormValue[],
): CalendarEventAlertFormValue {
  return {
    id: nextAlertId(existing),
    action: "display",
    offset: "-PT15M",
  };
}

export function nextAlertId(existing: CalendarEventAlertFormValue[]): string {
  const used = new Set(existing.map((alert) => alert.id));
  let index = 1;
  while (used.has(`alert${index}`)) index += 1;
  return `alert${index}`;
}

/**
 * Persist only real alerts. Choosing None on a set row removes it; choosing an
 * offset on the empty trailing slot appends one. The UI always shows one extra
 * None row — it is not stored here.
 */
export function alertsAfterOffsetChange(args: {
  alerts: CalendarEventAlertFormValue[];
  rowId: string | null;
  value: CalendarAlertOffsetSelectValue;
}): CalendarEventAlertFormValue[] {
  if (args.value === "none") {
    if (!args.rowId) return args.alerts;
    return args.alerts.filter((row) => row.id !== args.rowId);
  }
  const current = args.rowId ? args.alerts.find((row) => row.id === args.rowId) : undefined;
  const offset =
    args.value === "custom" ? (current?.offset ?? "-PT15M") : presetToOffset(args.value);
  if (!args.rowId) {
    return [...args.alerts, { id: nextAlertId(args.alerts), action: "display", offset }];
  }
  return args.alerts.map((row) =>
    row.id === args.rowId ? { ...row, offset, when: undefined } : row,
  );
}

function triggerRelatedTo(trigger: object): "start" | "end" {
  const relativeTo = "relativeTo" in trigger ? trigger.relativeTo : undefined;
  const relatedTo = "relatedTo" in trigger ? trigger.relatedTo : undefined;
  if (relativeTo === "end" || relatedTo === "end") return "end";
  return "start";
}

export function alertsFromWire(
  alerts: JSCalendarEvent["alerts"] | undefined | null,
): CalendarEventAlertFormValue[] {
  if (!alerts) return [];
  const rows: CalendarEventAlertFormValue[] = [];
  for (const [id, alert] of Object.entries(alerts)) {
    const row = alertFromWire(id, alert);
    if (row) rows.push(row);
  }
  return rows;
}

function alertFromWire(id: string, alert: JSCalendarAlert): CalendarEventAlertFormValue | null {
  const trigger = alert.trigger;
  if (!trigger || typeof trigger !== "object") return null;
  const action = alertActionFromWire(alert.action);
  if (typeof trigger.offset === "string" && trigger.offset.trim()) {
    const relatedTo = triggerRelatedTo(trigger);
    return {
      id,
      action,
      offset: trigger.offset,
      ...(relatedTo === "end" ? { relatedTo } : {}),
    };
  }
  if (typeof trigger.when === "string" && trigger.when.trim()) {
    return { id, action, offset: null, when: trigger.when };
  }
  return null;
}

export function alertsToWire(
  alerts: CalendarEventAlertFormValue[],
): Record<string, JSCalendarAlert> | null {
  if (alerts.length === 0) return null;
  const map: Record<string, JSCalendarAlert> = {};
  for (const row of alerts) {
    const alert = alertToWire(row);
    if (alert) map[row.id] = alert;
  }
  return Object.keys(map).length ? map : null;
}

function alertToWire(row: CalendarEventAlertFormValue): JSCalendarAlert | null {
  if (row.offset) {
    return {
      "@type": "Alert",
      action: DEFAULT_ALERT_ACTION,
      trigger: {
        "@type": "RelativeAlert",
        offset: row.offset,
        ...(row.relatedTo === "end" ? { relatedTo: "end" } : {}),
      },
    };
  }
  if (row.when) {
    return {
      "@type": "Alert",
      action: DEFAULT_ALERT_ACTION,
      trigger: {
        "@type": "AbsoluteAlert",
        when: row.when,
      },
    };
  }
  return null;
}

function normalizeAlert(alert: JSCalendarAlert): string {
  const trigger = alert.trigger;
  const action = alertActionFromWire(alert.action);
  if (trigger && typeof trigger === "object" && typeof trigger.offset === "string") {
    const related = triggerRelatedTo(trigger);
    return `offset:${action}:${trigger.offset}:${related}`;
  }
  if (trigger && typeof trigger === "object" && typeof trigger.when === "string") {
    return `absolute:${action}:${trigger.when}`;
  }
  return `opaque:${action}:${JSON.stringify(trigger)}`;
}

export function alertMapsEqual(
  left: Record<string, JSCalendarAlert> | null | undefined,
  right: Record<string, JSCalendarAlert> | null | undefined,
): boolean {
  const a = left && Object.keys(left).length ? left : null;
  const b = right && Object.keys(right).length ? right : null;
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const other = b[key];
    return Boolean(other) && normalizeAlert(a[key]) === normalizeAlert(other);
  });
}
