import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import {
  buildTaskDueOverlayModel,
  filterVisibleCalendarEventsKeepingOverlay,
  isTaskDueOverlayEvent,
  isTaskDueOverlayKey,
  mapTaskToDueOverlayMarker,
  mergeTaskDueOverlayEvents,
  omitTaskDueOverlayEvents,
  parseTaskDueOverlayKey,
  preserveTaskDueOverlayEvents,
  TASK_DUE_OVERLAY_ALL_DAY_DURATION,
  TASK_DUE_OVERLAY_TIMED_DURATION,
  taskDueOverlayKey,
  tasksListTaskHref,
} from "@/calendar-core/src/calendar-task-due-overlay";

const fullRights: TaskList["myRights"] = {
  mayReadItems: true,
  mayWriteAll: true,
  mayWriteOwn: true,
  mayUpdatePrivate: true,
  mayRSVP: true,
  mayAdmin: true,
  mayDelete: true,
  mayShare: true,
};

const lists: TaskList[] = [
  {
    id: "errands",
    name: "Errands",
    color: "#6366f1",
    sortOrder: 0,
    isDefault: false,
    isSubscribed: true,
    shareWith: null,
    isSharee: false,
    myRights: fullRights,
    scope: "personal",
    groupSlug: null,
  },
  {
    id: "sprint",
    name: "Sprint",
    color: "#f59e0b",
    sortOrder: 1,
    isDefault: false,
    isSubscribed: true,
    shareWith: null,
    isSharee: false,
    myRights: fullRights,
    scope: "personal",
    groupSlug: null,
  },
];

function task(partial: Partial<Task> & Pick<Task, "id" | "taskListId" | "title">): Task {
  return {
    "@type": "Task",
    uid: `urn:uuid:${partial.id}`,
    workflowStatus: "needs-action",
    isDraft: false,
    sortOrder: 0,
    categories: [],
    ...partial,
  };
}

function vevent(id: string, calendarId: string, color: string): CalendarEvent {
  return {
    eventId: id,
    calendarId,
    data: {
      start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
      duration: Temporal.Duration.from({ hours: 1 }),
      summary: id,
      color,
    },
  };
}

describe("task due overlay mapping", () => {
  it("maps date-only dues to all-day chips and timed dues to 30-minute blocks", () => {
    const dateOnly = mapTaskToDueOverlayMarker(
      task({
        id: "milk",
        taskListId: "errands",
        title: "Buy milk",
        due: "2033-01-12",
        showWithoutTime: true,
      }),
      lists,
    );
    const timed = mapTaskToDueOverlayMarker(
      task({
        id: "spec",
        taskListId: "sprint",
        title: "Review spec",
        due: "2033-01-12T14:30:00",
        showWithoutTime: false,
      }),
      lists,
    );

    expect(dateOnly?.key).toBe("task:milk");
    expect(dateOnly?.allDay).toBe(true);
    expect(dateOnly?.event.data.allDay).toBe(true);
    expect(dateOnly?.event.data.start.toString()).toBe("2033-01-12T00:00:00");
    expect(dateOnly?.event.data.duration?.toString()).toBe(
      TASK_DUE_OVERLAY_ALL_DAY_DURATION.toString(),
    );
    expect(dateOnly?.event.calendarId).toBeUndefined();
    expect(dateOnly?.event.overlayKind).toBe("task");
    expect(dateOnly?.listColor).toBe("#6366f1");

    expect(timed?.allDay).toBe(false);
    expect(timed?.event.data.start.toString()).toBe("2033-01-12T14:30:00");
    expect(timed?.event.data.duration?.toString()).toBe(TASK_DUE_OVERLAY_TIMED_DURATION.toString());
    expect(timed?.listColor).toBe("#f59e0b");
  });

  it("treats showWithoutTime as date-only even when due has a time", () => {
    const marker = mapTaskToDueOverlayMarker(
      task({
        id: "notes",
        taskListId: "errands",
        title: "Prep notes",
        due: "2033-01-12T09:00:00",
        showWithoutTime: true,
      }),
      lists,
    );
    expect(marker?.allDay).toBe(true);
    expect(marker?.event.data.start.toString()).toBe("2033-01-12T00:00:00");
  });

  it("omits completed, cancelled, and undated tasks", () => {
    expect(
      mapTaskToDueOverlayMarker(
        task({
          id: "done",
          taskListId: "errands",
          title: "Done",
          due: "2033-01-12",
          workflowStatus: "completed",
        }),
        lists,
      ),
    ).toBeNull();
    expect(
      mapTaskToDueOverlayMarker(
        task({
          id: "cancelled",
          taskListId: "errands",
          title: "Cancelled",
          due: "2033-01-12",
          workflowStatus: "cancelled",
        }),
        lists,
      ),
    ).toBeNull();
    expect(
      mapTaskToDueOverlayMarker(
        task({ id: "inbox", taskListId: "errands", title: "No due" }),
        lists,
      ),
    ).toBeNull();
  });

  it("omits hidden lists and filters by range", () => {
    const tasks = [
      task({ id: "milk", taskListId: "errands", title: "Buy milk", due: "2033-01-12" }),
      task({
        id: "spec",
        taskListId: "sprint",
        title: "Review spec",
        due: "2033-01-12T14:00:00",
        showWithoutTime: false,
      }),
      task({ id: "later", taskListId: "errands", title: "Later", due: "2033-02-01" }),
    ];
    const hidden = buildTaskDueOverlayModel(tasks, lists, {
      hiddenListIds: new Set(["sprint"]),
    });
    expect([...hidden.events.keys()]).toEqual(["task:milk", "task:later"]);

    const ranged = buildTaskDueOverlayModel(tasks, lists, {
      range: {
        start: Temporal.PlainDateTime.from("2033-01-12T00:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-13T00:00:00"),
      },
    });
    expect([...ranged.events.keys()].sort()).toEqual(["task:milk", "task:spec"]);
  });

  it("parses overlay keys and builds the Tasks deep-link", () => {
    expect(taskDueOverlayKey("abc")).toBe("task:abc");
    expect(parseTaskDueOverlayKey("task:abc")).toBe("abc");
    expect(parseTaskDueOverlayKey("dentist")).toBeNull();
    expect(isTaskDueOverlayKey("task:abc")).toBe(true);
    expect(isTaskDueOverlayKey("abc")).toBe(false);
    expect(tasksListTaskHref("errands", "milk")).toBe("/tasks/lists/errands?task=milk");
  });

  it("keeps overlay events when every calendar is hidden", () => {
    const overlay = buildTaskDueOverlayModel(
      [task({ id: "milk", taskListId: "errands", title: "Buy milk", due: "2033-01-12" })],
      lists,
    );
    const events: CalendarEventsMap = new Map([
      ["dentist", vevent("dentist", "default", "#111")],
      ...overlay.events,
    ]);
    const hidden = filterVisibleCalendarEventsKeepingOverlay(events, []);
    expect(hidden.has("dentist")).toBe(false);
    expect(hidden.has("task:milk")).toBe(true);

    const visible = filterVisibleCalendarEventsKeepingOverlay(events, ["work"]);
    expect(visible.has("dentist")).toBe(false);
    expect(visible.has("task:milk")).toBe(true);
  });

  it("merges overlay after calendar events and preserves it across EventsAPI replacements", () => {
    const overlay = buildTaskDueOverlayModel(
      [task({ id: "milk", taskListId: "errands", title: "Buy milk", due: "2033-01-12" })],
      lists,
    );
    const calendar: CalendarEventsMap = new Map([
      ["dentist", vevent("dentist", "default", "#111")],
    ]);
    const merged = mergeTaskDueOverlayEvents(calendar, overlay.events);
    expect(merged.size).toBe(2);
    expect(isTaskDueOverlayEvent(merged.get("task:milk"))).toBe(true);

    const afterApply = preserveTaskDueOverlayEvents(
      merged,
      new Map([["dentist", vevent("dentist", "default", "#222")]]),
    );
    expect(afterApply.get("task:milk")?.data.summary).toBe("Buy milk");
    expect(omitTaskDueOverlayEvents(afterApply).has("task:milk")).toBe(false);
  });
});
