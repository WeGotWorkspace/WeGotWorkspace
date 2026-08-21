import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { JmapSetItemError } from "@/lib/jmap-client";
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import {
  enqueueCoalescedCalendarEventUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readCalendarBootstrapFromCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";
import { CalendarSchedulingGoneError } from "@/lib/api/wgw/calendar-scheduling";
import { flushCalendarsOutbox } from "@/lib/offline/calendars-outbox-flush";

const username = "bob";

function wireEvent(id: string, title: string): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: `urn:uuid:${id}`,
    calendarIds: { default: true },
    title,
    start: "2033-01-10T10:00:00",
    duration: "PT30M",
    timeZone: "Etc/UTC",
  } as JmapCalendarEvent;
}

const bootstrap = {
  session: mockWorkspaceSession,
  data: {
    calendars: [{ id: "default", name: "Personal", color: "#6366f1", isDefault: true }],
    events: [wireEvent("ev-1", "Standup")],
  },
} satisfies CalendarAppBootstrap;

const {
  createCalendarEventLive,
  patchCalendarEventLive,
  deleteCalendarEventLive,
  createCalendarLive,
  patchCalendarLive,
  deleteCalendarLive,
  respondCalendarSchedulingNotification,
} = vi.hoisted(() => ({
  createCalendarEventLive: vi.fn(),
  patchCalendarEventLive: vi.fn(),
  deleteCalendarEventLive: vi.fn(),
  createCalendarLive: vi.fn(),
  patchCalendarLive: vi.fn(),
  deleteCalendarLive: vi.fn(),
  respondCalendarSchedulingNotification: vi.fn(),
}));

vi.mock("@/lib/api/wgw/calendar", () => ({
  createCalendarEventLive,
  patchCalendarEventLive,
  deleteCalendarEventLive,
  createCalendarLive,
  patchCalendarLive,
  deleteCalendarLive,
}));

vi.mock("@/lib/api/wgw/calendar-scheduling", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/calendar-scheduling")>();
  return {
    ...actual,
    respondCalendarSchedulingNotification,
  };
});

describe("flushCalendarsOutbox", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await writeCalendarBootstrapToCache(username, bootstrap);
    for (const row of await listOutboxMutations(username)) {
      const { removeOutboxMutation } = await import("@/lib/offline/calendars-offline-store");
      await removeOutboxMutation(username, row.id);
    }
  });

  it("replays create, update, and delete rows in order and clears them", async () => {
    createCalendarEventLive.mockResolvedValue(wireEvent("ev-2", "Created"));
    patchCalendarEventLive.mockResolvedValue(wireEvent("ev-1", "Patched"));
    deleteCalendarEventLive.mockResolvedValue(undefined);

    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        creationId: "local-1",
        tempEventId: "local-1",
        draft: {
          calendarId: "default",
          title: "Created",
          start: "2033-01-11T09:00:00",
          duration: "PT1H",
        },
      }),
    });
    await enqueueCoalescedCalendarEventUpdate(username, "ev-1", { title: "Patched" });
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ eventId: "ev-gone" }),
    });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual([]);
    expect(result.schedulingConflicts).toEqual([]);
    expect(createCalendarEventLive).toHaveBeenCalledTimes(1);
    expect(patchCalendarEventLive).toHaveBeenCalledWith("ev-1", { title: "Patched" });
    expect(deleteCalendarEventLive).toHaveBeenCalledWith("ev-gone");
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "ev-1")?.title).toBe("Patched");
    expect(cached?.data.events.some((event) => event.id === "ev-2")).toBe(true);
  });

  it("coalesces successive patches for the same event into one outbox row", async () => {
    await enqueueCoalescedCalendarEventUpdate(username, "ev-1", { title: "First" });
    await enqueueCoalescedCalendarEventUpdate(username, "ev-1", { duration: "PT2H" });

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payload).patch).toEqual({ title: "First", duration: "PT2H" });
  });

  it("marks rejected set items as conflicts and keeps the row", async () => {
    patchCalendarEventLive.mockRejectedValue(
      new JmapSetItemError("update", "ev-1", { type: "notFound" }),
    );
    await enqueueCoalescedCalendarEventUpdate(username, "ev-1", { title: "Patched" });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual(["ev-1"]);
    expect(result.schedulingConflicts).toEqual([]);
    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastError).toBe("conflict");
  });

  it("marks transport failures with the error message and keeps the row", async () => {
    deleteCalendarEventLive.mockRejectedValue(new Error("boom"));
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ eventId: "ev-1" }),
    });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual([]);
    expect(result.schedulingConflicts).toEqual([]);
    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastError).toBe("boom");
  });

  it("uses notificationId when a queued RSVP hits a set conflict", async () => {
    respondCalendarSchedulingNotification.mockRejectedValue(
      new JmapSetItemError("update", "invite-1.ics", { type: "notFound" }),
    );
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "respond-scheduling",
      payload: JSON.stringify({
        notificationId: "invite-1.ics",
        participationStatus: "declined",
      }),
    });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual([]);
    expect(result.schedulingConflicts).toEqual(["invite-1.ics"]);
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });

  it("replays calendarCreate, calendarUpdate, and calendarDelete rows", async () => {
    createCalendarLive.mockResolvedValue({
      id: "cal-2",
      name: "Team",
      color: "#22c55e",
      scope: "group",
      groupSlug: "engineering",
    });
    patchCalendarLive.mockResolvedValue({
      id: "default",
      name: "Renamed",
      color: "#111111",
      isDefault: true,
    });
    deleteCalendarLive.mockResolvedValue(undefined);

    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "calendarCreate",
      payload: JSON.stringify({
        creationId: "local-cal-1",
        tempCalendarId: "local-cal-1",
        draft: { name: "Team", color: "#22c55e", groupSlug: "engineering" },
      }),
    });
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "calendarUpdate",
      payload: JSON.stringify({ calendarId: "default", patch: { name: "Renamed" } }),
    });
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "calendarDelete",
      payload: JSON.stringify({ calendarId: "gone" }),
    });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual([]);
    expect(createCalendarLive).toHaveBeenCalledWith({
      name: "Team",
      color: "#22c55e",
      groupSlug: "engineering",
    });
    expect(patchCalendarLive).toHaveBeenCalledWith("default", { name: "Renamed" });
    expect(deleteCalendarLive).toHaveBeenCalledWith("gone");
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.calendars.find((calendar) => calendar.id === "cal-2")?.name).toBe("Team");
    expect(cached?.data.calendars.find((calendar) => calendar.id === "default")?.name).toBe(
      "Renamed",
    );
  });

  it("drops a queued RSVP when the invitation is gone and reports the notification id", async () => {
    respondCalendarSchedulingNotification.mockRejectedValue(
      new CalendarSchedulingGoneError("invite-1.ics"),
    );
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CALENDARS_DOMAIN,
      op: "respond-scheduling",
      payload: JSON.stringify({
        notificationId: "invite-1.ics",
        participationStatus: "accepted",
      }),
    });

    const result = await flushCalendarsOutbox(username);

    expect(result.conflicts).toEqual([]);
    expect(result.schedulingConflicts).toEqual(["invite-1.ics"]);
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });
});
