import type { CalendarEventSelectionOrigin } from "@/calendar-core/src/calendar-event-preview";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarAvailabilityPopover } from "@/calendar-core/src/calendar-availability-popover";
import {
  resolveAvailabilityPreview,
  type AvailabilityPreview,
} from "@/calendar-core/src/calendar-availability-preview";
import { parseAvailabilityOverlayKey } from "@/calendar-core/src/calendar-availability-overlay";
import { CalendarTaskDuePopover } from "@/calendar-core/src/calendar-task-due-popover";
import {
  parseTaskDueOverlayKey,
  type TaskDueOverlayMarker,
} from "@/calendar-core/src/calendar-task-due-overlay";
import type { TeamAvailabilityState } from "@/calendar-core/src/use-team-availability";

/** The read-only popover open for a render-only grid card. */
export type CalendarOverlayPreview = { key: string; origin?: CalendarEventSelectionOrigin } & (
  | { kind: "task"; marker: TaskDueOverlayMarker }
  | { kind: "availability"; preview: AvailabilityPreview }
);

export type CalendarOverlayPreviewSources = {
  taskDueMarkers: readonly TaskDueOverlayMarker[];
  availability: Pick<TeamAvailabilityState, "periodsByUser" | "members"> &
    Partial<Pick<TeamAvailabilityState, "colors">>;
};

/**
 * The overlay popover for a clicked card key. `undefined` when the key is a
 * real event; `null` when it is an overlay whose source is gone.
 */
export function resolveCalendarOverlayPreview(
  key: string,
  origin: CalendarEventSelectionOrigin | undefined,
  { taskDueMarkers, availability }: CalendarOverlayPreviewSources,
): CalendarOverlayPreview | null | undefined {
  const taskId = parseTaskDueOverlayKey(key);
  if (taskId) {
    const marker =
      taskDueMarkers.find((entry) => entry.key === key) ??
      taskDueMarkers.find((entry) => entry.taskId === taskId);
    return marker ? { kind: "task", key: marker.key, marker, origin } : null;
  }
  if (parseAvailabilityOverlayKey(key)) {
    const preview = resolveAvailabilityPreview(
      key,
      availability.periodsByUser,
      availability.members,
      availability.colors,
    );
    return preview ? { kind: "availability", key, preview, origin } : null;
  }
  return undefined;
}

export function CalendarOverlayPopover({
  preview,
  labels,
  locale,
  timeZone,
  onClose,
  onOpenInTasks,
}: {
  preview: CalendarOverlayPreview;
  labels: CalendarUILabels;
  locale: string;
  timeZone?: string;
  onClose: () => void;
  onOpenInTasks?: (href: string) => void;
}) {
  if (preview.kind === "availability") {
    return (
      <CalendarAvailabilityPopover
        open
        preview={preview.preview}
        labels={labels}
        locale={locale}
        timeZone={timeZone}
        origin={preview.origin}
        onClose={onClose}
      />
    );
  }
  return (
    <CalendarTaskDuePopover
      open
      marker={preview.marker}
      labels={labels}
      locale={locale}
      origin={preview.origin}
      onClose={onClose}
      onOpenInTasks={onOpenInTasks}
    />
  );
}
