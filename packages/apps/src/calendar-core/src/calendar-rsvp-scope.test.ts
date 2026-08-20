import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  eventIsRecurringForRsvp,
  persistInviteeRsvp,
  queueUndoableRespond,
  respondScopeFromChoice,
  rsvpRecurrenceIdForEvent,
  rsvpUndoStatus,
  shouldAskRsvpOccurrenceScope,
} from "@/calendar-core/src/calendar-rsvp-scope";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";

function wireEvent(overrides: Partial<JmapCalendarEvent> = {}): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: "standup",
    uid: "standup-uid",
    calendarIds: { work: true },
    title: "Standup",
    start: "2033-01-10T09:30:00",
    duration: "PT30M",
    timeZone: "Etc/UTC",
    recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
    ...overrides,
  } as JmapCalendarEvent;
}

describe("calendar-rsvp-scope", () => {
  it("maps the shared edit/delete choice onto respond scope", () => {
    expect(respondScopeFromChoice("thisInstance")).toBe("this");
    expect(respondScopeFromChoice("thisAndFuture")).toBe("future");
    expect(respondScopeFromChoice("allInstances")).toBeNull();
    expect(respondScopeFromChoice(null)).toBeNull();
  });

  it("treats a series, inbox recurring flag, or occurrence id as recurring", () => {
    expect(eventIsRecurringForRsvp(wireEvent())).toBe(true);
    expect(eventIsRecurringForRsvp(undefined, true)).toBe(true);
    expect(eventIsRecurringForRsvp({ recurrenceRules: [] }, false, "2033-01-10T09:30:00")).toBe(
      true,
    );
    expect(eventIsRecurringForRsvp({ recurrenceRules: [] })).toBe(false);
    expect(eventIsRecurringForRsvp(undefined, false)).toBe(false);
  });

  it("prefers the clicked occurrence, then the next upcoming instance", () => {
    expect(
      rsvpRecurrenceIdForEvent({
        editorRecurrenceId: "20330117T093000",
        event: wireEvent(),
      }),
    ).toBe("2033-01-17T09:30:00");
    expect(rsvpRecurrenceIdForEvent({ event: wireEvent() })).toBe("2033-01-10T09:30:00");
    expect(
      rsvpRecurrenceIdForEvent({
        notification: { start: "2033-01-10T09:30:00", recurring: true },
      }),
    ).toBe("2033-01-10T09:30:00");
  });

  it("asks this / this-and-future only when changing a set RSVP from the edit dialog", () => {
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
        previousStatus: "accepted",
      }),
    ).toBe(true);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
        previousStatus: "tentative",
      }),
    ).toBe(true);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
        previousStatus: "declined",
      }),
    ).toBe(true);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
        previousStatus: "needs-action",
      }),
    ).toBe(false);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
        previousStatus: null,
      }),
    ).toBe(false);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: true,
      }),
    ).toBe(false);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "preview",
        recurring: true,
        previousStatus: "accepted",
      }),
    ).toBe(true);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "sidebar",
        recurring: true,
        previousStatus: "accepted",
      }),
    ).toBe(false);
    expect(
      shouldAskRsvpOccurrenceScope({
        source: "dialog",
        recurring: false,
        previousStatus: "accepted",
      }),
    ).toBe(false);
  });

  it("sidebar recurring RSVP persists series-wide without a scope dialog", async () => {
    const askScope = vi.fn();
    const respond = vi.fn().mockResolvedValue(undefined);
    const persisted = await persistInviteeRsvp({
      source: "sidebar",
      recurring: true,
      previousStatus: "needs-action",
      masterId: "standup",
      recurrenceId: "2033-01-17T09:30:00",
      askScope,
      respond,
    });
    expect(persisted).toBe(true);
    expect(askScope).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith();
  });

  it("dialog Save from needs-action skips the prompt and applies the series", async () => {
    const askScope = vi.fn();
    const respond = vi.fn().mockResolvedValue(undefined);
    const persisted = await persistInviteeRsvp({
      source: "dialog",
      recurring: true,
      previousStatus: "needs-action",
      masterId: "standup",
      recurrenceId: "2033-01-17T09:30:00",
      askScope,
      respond,
    });
    expect(persisted).toBe(true);
    expect(askScope).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith();
  });

  it("dialog Save from accepted to declined on a series shows this / this-and-future", async () => {
    const askScope = vi.fn().mockResolvedValue("thisInstance");
    const respond = vi.fn().mockResolvedValue(undefined);
    const persisted = await persistInviteeRsvp({
      source: "dialog",
      recurring: true,
      previousStatus: "accepted",
      masterId: "standup",
      recurrenceId: "2033-01-17T09:30:00",
      askScope,
      respond,
    });
    expect(persisted).toBe(true);
    expect(askScope).toHaveBeenCalledWith({
      action: "edit",
      masterId: "standup",
      recurrenceId: "2033-01-17T09:30:00",
    });
    expect(respond).toHaveBeenCalledWith({
      scope: "this",
      recurrenceId: "2033-01-17T09:30:00",
    });
  });

  it("skips the prompt on a one-off and cancels when the shared dialog is dismissed", async () => {
    const respond = vi.fn().mockResolvedValue(undefined);
    await persistInviteeRsvp({
      source: "dialog",
      recurring: false,
      previousStatus: "accepted",
      masterId: "one-off",
      askScope: vi.fn(),
      respond,
    });
    expect(respond).toHaveBeenCalledWith();

    const cancelled = await persistInviteeRsvp({
      source: "dialog",
      recurring: true,
      previousStatus: "accepted",
      masterId: "standup",
      askScope: vi.fn().mockResolvedValue(null),
      respond: vi.fn(),
    });
    expect(cancelled).toBe(false);
  });
});

describe("calendar RSVP prompt reuse", () => {
  it("workspace reuses the edit/delete recurrence scope dialog for RSVP", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
    expect(workspace).toContain("persistInviteeRsvp");
    expect(workspace).toContain("askRecurrenceScope");
    expect(workspace).toContain("CalendarRecurrenceScopeDialog");
    expect(workspace).not.toContain("recurrenceScopeRsvpTitle");
    expect(workspace).toContain('source: "sidebar"');
    expect(workspace).toContain('source: "dialog"');
    expect(workspace).toContain("previousStatus");
    expect(workspace).toContain("queueUndoableRespond");
    expect(workspace).toContain("queueMutation");
    expect(workspace).toContain("toastRsvpUpdated");
    expect(workspace).toContain("toastRsvpUndone");
  });
});

describe("queueUndoableRespond", () => {
  it("runs the RSVP write then undo restores the previous PARTSTAT", async () => {
    const respond = vi.fn().mockResolvedValue(undefined);
    const queued: DeferredApiWriteArgs[] = [];
    await queueUndoableRespond({
      queueMutation: (write) => {
        queued.push(write);
        void write.execute(new AbortController().signal);
      },
      key: "calendar:rsvp:invite-1:accepted",
      toastMessage: "Invitation updated",
      undoToastMessage: "Invitation change undone.",
      execute: () => respond("accepted"),
      undo: () => {
        const revert = rsvpUndoStatus("tentative");
        if (revert) void respond(revert);
      },
    });

    expect(respond).toHaveBeenCalledWith("accepted");
    expect(queued[0]?.executeImmediately).toBe(true);
    queued[0]?.undo();
    expect(respond).toHaveBeenLastCalledWith("tentative");
  });

  it("does not revert a first RSVP from needs-action", () => {
    expect(rsvpUndoStatus("needs-action")).toBeUndefined();
    expect(rsvpUndoStatus(undefined)).toBeUndefined();
  });
});
