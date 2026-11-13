/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMeshCheckNowPort } from "@/lib/jmap-client/push/mesh-check-now";
import {
  upsertCalendarEventInCache,
  upsertCalendarInCache,
} from "@/lib/offline/calendars/calendars-offline-store";
import {
  cachedCollectionAudience,
  cachedItemAudience,
  checkNowAfterWrite,
  shareWithAudience,
} from "@/lib/offline/core/collection-check-now";
import {
  rememberOfflineCalendarsUsername,
  rememberOfflineTasksUsername,
} from "@/lib/offline/core/offline-session";
import { upsertTaskInCache, upsertTaskListInCache } from "@/lib/offline/tasks/tasks-offline-store";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import type { JmapCalendarEvent } from "@/lib/jmap-client/calendars/types";
import type { Task, TaskList } from "@/lib/models/tasks-types";

const username = "bob";
const shared = { alice: { mayRead: true }, "groups/eng": { mayRead: true }, carol: null };

describe("collection check-now audience", () => {
  beforeEach(async () => {
    rememberOfflineTasksUsername(username);
    rememberOfflineCalendarsUsername(username);
    await upsertTaskListInCache(username, {
      id: "list-shared",
      name: "Shared",
      shareWith: shared,
    } as unknown as TaskList);
    await upsertTaskListInCache(username, { id: "list-own", name: "Own" } as unknown as TaskList);
    await upsertTaskInCache(username, {
      id: "task-1",
      taskListId: "list-shared",
      title: "Pay rent",
    } as unknown as Task);
  });

  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("names only user grants, never groups or revoked entries", () => {
    expect(shareWithAudience(shared)).toEqual(["alice"]);
    expect(shareWithAudience(null)).toEqual([]);
  });

  it("knows the audience of a cached collection, and of the collection of an item", async () => {
    expect(await cachedCollectionAudience("tasks", ["list-shared"])).toEqual(["alice"]);
    expect(await cachedItemAudience("tasks", "task-1")).toEqual(["alice"]);
  });

  it("knows nobody for an unshared, unknown or sharee-side collection", async () => {
    expect(await cachedCollectionAudience("tasks", ["list-own"])).toEqual([]);
    expect(await cachedCollectionAudience("tasks", ["missing", null, undefined])).toEqual([]);
    expect(await cachedItemAudience("tasks", "missing")).toEqual([]);
  });

  it("reads calendars and events the same way", async () => {
    await upsertCalendarInCache(username, {
      id: "cal-1",
      name: "Team",
      shareWith: { dave: { mayRead: true } },
    } as unknown as CalendarInfo);
    await upsertCalendarEventInCache(username, {
      id: "ev-1",
      calendarIds: { "cal-1": true },
    } as unknown as JmapCalendarEvent);
    expect(await cachedCollectionAudience("calendars", ["cal-1"])).toEqual(["dave"]);
    expect(await cachedItemAudience("calendars", "ev-1")).toEqual(["dave"]);
  });

  it("nudges the cached audience plus the share list a response returned", async () => {
    const sent: string[][] = [];
    unregister = registerMeshCheckNowPort({
      sendCheckNow: (usernames) => sent.push([...usernames]),
      subscribeCheckNow: () => () => undefined,
      meshLinked: () => false,
      subscribeMeshLinked: () => () => undefined,
    });
    checkNowAfterWrite(
      [cachedCollectionAudience("tasks", ["list-shared"]), Promise.reject(new Error("x"))],
      { erin: { mayRead: true } },
    );
    // The cached audience comes from IndexedDB, which can take more than one tick.
    await vi.waitFor(() => expect(sent).toEqual([["alice", "erin"]]));
  });
});
