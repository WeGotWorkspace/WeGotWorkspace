import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  calendarsHybridDomainOperations,
  calendarsOfflineDomainStore,
} from "@/lib/offline/calendars/calendars-domain-contract";

const username = "bob";

const event = {
  "@type": "Event",
  id: "ev-1",
  uid: "urn:uuid:ev-1",
  calendarIds: { default: true },
  title: "Standup",
  start: "2033-01-10T10:00:00",
  duration: "PT30M",
  timeZone: "Etc/UTC",
} as JmapCalendarEvent;

const bootstrap = {
  session: mockWorkspaceSession,
  data: {
    calendars: [{ id: "default", name: "Personal", color: "#6366f1", isDefault: true }],
    events: [event],
  },
} satisfies CalendarAppBootstrap;

/** Compile-time contract checks — referenced so the assignment is not elided. */
const storeContractCheck: OfflineDomainStore<CalendarAppBootstrap, JmapCalendarEvent> =
  calendarsOfflineDomainStore;
const operationsContractCheck: OfflineDomainOperations<CalendarAPIOperations> =
  calendarsHybridDomainOperations;

void storeContractCheck;
void operationsContractCheck;

describe("calendars domain contract", () => {
  beforeEach(async () => {
    await calendarsOfflineDomainStore.writeBootstrap(username, bootstrap);
  });

  it("store contract reads and writes bootstrap", async () => {
    const cached = await calendarsOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.events[0]?.title).toBe("Standup");
    expect(cached?.data.calendars[0]?.name).toBe("Personal");
  });

  it("store contract upserts and removes entities", async () => {
    const updated = { ...event, title: "Standup (moved)" } as JmapCalendarEvent;
    await calendarsOfflineDomainStore.upsertEntity(username, updated, true);
    const cached = await calendarsOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.events[0]?.title).toBe("Standup (moved)");

    await calendarsOfflineDomainStore.removeEntity(username, updated.id);
    const afterRemove = await calendarsOfflineDomainStore.readBootstrap(username);
    expect(afterRemove?.data.events).toHaveLength(0);
  });

  it("store contract reads and writes sync tokens", async () => {
    await calendarsOfflineDomainStore.writeSyncToken(username, "default", "3:default:7");
    await expect(calendarsOfflineDomainStore.readSyncToken(username, "default")).resolves.toBe(
      "3:default:7",
    );
  });

  it("pending rows survive a bootstrap rewrite", async () => {
    const pending = { ...event, id: "local-1", title: "Offline draft" } as JmapCalendarEvent;
    await calendarsOfflineDomainStore.upsertEntity(username, pending, true);
    await calendarsOfflineDomainStore.writeBootstrap(username, bootstrap);
    const cached = await calendarsOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.events.map((entry) => entry.id).sort()).toEqual(["ev-1", "local-1"]);
  });

  it("operations factory exposes hybrid API methods", () => {
    const operations = calendarsHybridDomainOperations(username);
    expect(typeof operations.createEvent).toBe("function");
    expect(typeof operations.patchEvent).toBe("function");
    expect(typeof operations.deleteEvent).toBe("function");
  });
});
