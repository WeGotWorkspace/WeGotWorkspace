import { describe, expect, it } from "vitest";
import {
  formatNotificationCopy,
  whenLabel,
} from "@/notifications-core/src/format-notification-copy";

describe("formatNotificationCopy", () => {
  it("formats chat.message_posted channel and dm", () => {
    const channel = formatNotificationCopy({
      domain: "chat",
      action: "message_posted",
      title: "legacy",
      body: "legacy",
      data: {
        actor: "Alice",
        channelKind: "channel",
        channelName: "General",
        snippet: "hello team",
        isDm: false,
      },
    });
    expect(channel).toEqual({
      title: "Alice sent a message in #general",
      titleActor: "Alice",
      titleRest: " sent a message in #general",
      body: "hello team",
    });

    const dm = formatNotificationCopy({
      domain: "chat",
      action: "message_posted",
      title: "legacy",
      body: null,
      data: {
        actor: "Alice",
        channelKind: "dm",
        channelName: "Bob",
        snippet: "halo",
        isDm: true,
      },
    });
    expect(dm).toEqual({
      title: "Alice sent you a direct message",
      titleActor: "Alice",
      titleRest: " sent you a direct message",
      body: "halo",
    });
  });

  it("formats docs.shared with path subtitle", () => {
    const copy = formatNotificationCopy({
      domain: "docs",
      action: "shared",
      title: "legacy",
      body: null,
      data: {
        actor: "bob",
        path: "/users/bob/notes.md",
        fileName: "notes.md",
      },
    });
    expect(copy).toEqual({
      title: "bob shared notes.md with you",
      titleActor: "bob",
      titleRest: " shared notes.md with you",
      body: "/users/bob/notes.md",
    });
  });

  it("formats docs.thread_activity comment and reply", () => {
    const comment = formatNotificationCopy({
      domain: "docs",
      action: "thread_activity",
      title: "legacy",
      body: null,
      data: {
        actor: "Alice",
        fileName: "plan.md",
        kind: "comment",
        isReply: false,
        snippet: "please clarify",
      },
    });
    expect(comment).toEqual({
      title: "Alice left a comment on plan.md",
      titleActor: "Alice",
      titleRest: " left a comment on plan.md",
      body: "please clarify",
    });

    const reply = formatNotificationCopy({
      domain: "docs",
      action: "thread_activity",
      title: "legacy",
      body: null,
      data: {
        actor: "Bob",
        fileName: "plan.md",
        kind: "comment",
        isReply: true,
        snippet: "done",
      },
    });
    expect(reply.title).toBe("Bob replied on plan.md");
  });

  it("formats calendar.rsvp, collection shared, task status, chat mention, meet started", () => {
    expect(
      formatNotificationCopy({
        domain: "calendar",
        action: "rsvp",
        title: "legacy",
        body: null,
        data: {
          actor: "Carol",
          summary: "Standup",
          participationStatus: "accepted",
          start: "2030-01-15T10:00:00Z",
          end: "2030-01-15T10:30:00Z",
        },
      }).title,
    ).toBe("Carol accepted Standup");

    expect(
      formatNotificationCopy({
        domain: "calendar",
        action: "shared",
        title: "legacy",
        body: null,
        data: { actor: "Bob", calendarName: "Work", access: "write" },
      }),
    ).toEqual({
      title: "Bob shared Work with you",
      titleActor: "Bob",
      titleRest: " shared Work with you",
      body: "calendar access: write",
    });

    expect(
      formatNotificationCopy({
        domain: "tasks",
        action: "status_changed",
        title: "legacy",
        body: null,
        data: {
          actor: "Alice",
          summary: "Pay rent",
          fromStatus: "needs-action",
          toStatus: "completed",
        },
      }).title,
    ).toBe("Alice completed Pay rent");

    expect(
      formatNotificationCopy({
        domain: "chat",
        action: "mentioned",
        title: "legacy",
        body: null,
        data: {
          actor: "Alice",
          channelKind: "channel",
          channelName: "General",
          snippet: "hey @bob",
          isDm: false,
        },
      }).title,
    ).toBe("Alice mentioned you in #general");

    expect(
      formatNotificationCopy({
        domain: "meet",
        action: "started",
        title: "legacy",
        body: null,
        data: { actor: "Alice", room: "abc-room" },
      }),
    ).toEqual({
      title: "Alice started a meeting",
      titleActor: "Alice",
      titleRest: " started a meeting",
      body: "abc-room",
    });
  });

  it("formats calendar.alert_due and tasks.alert_due when labels", () => {
    const start = "2026-09-12T12:15:00+00:00";
    const end = "2026-09-12T13:15:00+00:00";
    const calendar = formatNotificationCopy({
      domain: "calendar",
      action: "alert_due",
      title: "legacy",
      body: null,
      data: { summary: "Standup", start, end },
    });
    expect(calendar).toEqual({
      title: "Standup",
      body: "Sat 12 Sep · 12:15 – 13:15",
    });

    const task = formatNotificationCopy({
      domain: "tasks",
      action: "alert_due",
      title: "legacy",
      body: null,
      data: { summary: "Pay rent", start: "2026-09-12T12:10:00Z", end: "2026-09-12T12:10:00Z" },
    });
    expect(task.body).toBe("Due Sat 12 Sep · 12:10");
  });

  it("formats calendar.invite with when and location", () => {
    const copy = formatNotificationCopy({
      domain: "calendar",
      action: "invite",
      title: "legacy",
      body: null,
      data: {
        actor: "Nathalie",
        summary: "Zaterdag Open",
        start: "2026-09-19T09:00:00Z",
        end: "2026-09-19T12:00:00Z",
        location: "Dorpsstraat",
      },
    });
    expect(copy).toEqual({
      title: "Nathalie invited you to Zaterdag Open",
      titleActor: "Nathalie",
      titleRest: " invited you to Zaterdag Open",
      body: "Sat 19 Sep · 09:00 – 12:00 · Dorpsstraat",
    });
  });

  it("falls back to stored title/body when data is missing", () => {
    expect(
      formatNotificationCopy({
        domain: "docs",
        action: "shared",
        title: "Stored title",
        body: "Stored body",
        data: null,
      }),
    ).toEqual({ title: "Stored title", body: "Stored body" });
  });
});

describe("whenLabel", () => {
  it("matches PHP day-range shape", () => {
    const start = new Date("2026-09-12T12:15:00Z");
    const end = new Date("2026-09-12T13:15:00Z");
    expect(whenLabel("calendar", start, end)).toBe("Sat 12 Sep · 12:15 – 13:15");
  });
});
