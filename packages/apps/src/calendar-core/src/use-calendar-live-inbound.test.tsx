import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_BACKGROUND_POLL_MS,
  CALENDAR_PUSH_POLL_MS,
} from "@/calendar-core/src/calendar-refresh";
import { useCalendarLiveInbound } from "@/calendar-core/src/use-calendar-live-inbound";
import { JmapClient, JmapEventsAdapter, type JmapCalendarEvent } from "@/lib/jmap-client";
import type { JmapInvocation } from "@/lib/jmap-client/core/types";
import { timedEvent, workCalendar } from "@/lib/jmap-client/mock/fixtures";
import { MockJmapServer } from "@/lib/jmap-client/mock/MockJmapServer";
import {
  StateChangeSubscription,
  type StateChangeListener,
} from "@/lib/jmap-client/push/state-change-subscription";

/**
 * A push hub without a stream: `push` hands states to the real
 * `StateChangeSubscription`, which coalesces them the way the hub does.
 */
const hub = vi.hoisted(() => ({
  connected: false,
  statusListeners: new Set<() => void>(),
  subscriptions: [] as { offer: StateChangeSubscription["offer"]; types: readonly string[] }[],
  runs: [] as Promise<unknown>[],
}));

vi.mock("@/lib/api/wgw/jmap-push", () => ({
  defaultJmapPushHub: () => ({
    get connected() {
      return hub.connected;
    },
    subscribeStatus: (listener: () => void) => {
      hub.statusListeners.add(listener);
      return () => hub.statusListeners.delete(listener);
    },
    subscribe: (types: readonly string[], listener: StateChangeListener) => {
      const tracked: StateChangeListener = (states, accountId) => {
        const run = Promise.resolve(listener(states, accountId));
        hub.runs.push(run);
        return run;
      };
      const subscription = new StateChangeSubscription(types, tracked, () => undefined);
      hub.subscriptions.push(subscription);
      return () => {
        subscription.dispose();
        hub.subscriptions = hub.subscriptions.filter((entry) => entry !== subscription);
      };
    },
  }),
}));

const MARCH = {
  utcStart: new Date("2026-03-01T00:00:00Z"),
  utcEnd: new Date("2026-04-01T00:00:00Z"),
};

function push(accountId: string, states: Record<string, string>): void {
  const pushed = Object.fromEntries(
    Object.entries(states).map(([type, state]) => [type, { state, hash: null }]),
  );
  for (const subscription of hub.subscriptions) subscription.offer(accountId, pushed);
}

/** Every listener run that started, including ones queued behind a run in flight. */
async function settled(): Promise<unknown[]> {
  let seen = -1;
  while (seen !== hub.runs.length) {
    seen = hub.runs.length;
    await Promise.all(hub.runs);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return Promise.all(hub.runs);
}

async function liveAdapter(server: MockJmapServer) {
  const methods: string[] = [];
  const client = new JmapClient({
    sessionUrl: server.sessionUrl,
    fetch: async (input, init) => {
      if (init?.body) {
        const request = JSON.parse(String(init.body)) as { methodCalls: JmapInvocation[] };
        for (const [name] of request.methodCalls) methods.push(name);
      }
      return server.fetch(input, init);
    },
  });
  const ingested: string[] = [];
  const adapter = new JmapEventsAdapter({
    client,
    onRemoteEvent: (event: JmapCalendarEvent) => {
      if (event.title) ingested.push(event.title);
    },
  });
  await adapter.initialize(MARCH);
  methods.length = 0;
  ingested.length = 0;
  return { adapter, methods, ingested };
}

function count(methods: string[], name: string): number {
  return methods.filter((method) => method === name).length;
}

describe("useCalendarLiveInbound", () => {
  let server: MockJmapServer;

  beforeEach(() => {
    hub.connected = false;
    hub.statusListeners.clear();
    hub.subscriptions = [];
    hub.runs = [];
    server = new MockJmapServer();
    server.seedCalendar(workCalendar);
    server.seedEvent(timedEvent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to CalendarEvent and Calendar only once the adapter is ready", async () => {
    const { adapter } = await liveAdapter(server);
    const { rerender } = renderHook(({ ready }) => useCalendarLiveInbound(ready), {
      initialProps: { ready: null as JmapEventsAdapter | null },
    });
    expect(hub.subscriptions).toHaveLength(0);

    rerender({ ready: adapter });

    expect(hub.subscriptions.map((entry) => [...entry.types].sort())).toEqual([
      ["Calendar", "CalendarEvent"],
    ]);
  });

  it("runs one coalesced sync for pushes with a differing state", async () => {
    const { adapter, methods, ingested } = await liveAdapter(server);
    renderHook(() => useCalendarLiveInbound(adapter));

    server.remoteCreateEvent({ ...timedEvent, title: "Pushed lunch" });
    server.remoteUpdateEvent(timedEvent.id, { title: "Moved standup" });
    // Three pushes in one tick: the subscription hands the newest to one sync.
    act(() => {
      push(server.accountId, { CalendarEvent: "stale-1" });
      push(server.accountId, { CalendarEvent: "stale-2", Calendar: "stale-2" });
      push(server.accountId, { CalendarEvent: server.state, Calendar: server.state });
    });
    const results = await act(settled);

    expect(results).toEqual([true]);
    expect(count(methods, "CalendarEvent/changes")).toBe(1);
    expect(ingested.sort()).toEqual(["Moved standup", "Pushed lunch"]);
  });

  it("does not sync when the pushed state equals the adapter's own", async () => {
    const { adapter, methods } = await liveAdapter(server);
    renderHook(() => useCalendarLiveInbound(adapter));

    act(() => push(server.accountId, { CalendarEvent: server.state, Calendar: server.state }));
    const results = await act(settled);

    expect(results).toEqual([true]);
    expect(methods).toEqual([]);
  });

  it("leaves another account's push alone", async () => {
    const { adapter, methods } = await liveAdapter(server);
    renderHook(() => useCalendarLiveInbound(adapter));

    act(() => push("someone-else", { CalendarEvent: "other" }));
    await act(settled);

    expect(methods).toEqual([]);
  });

  it("polls every 10 s without push and every 60 s while push is connected", async () => {
    const { adapter } = await liveAdapter(server);
    const startPolling = vi.spyOn(adapter, "startPolling");
    const stopPolling = vi.spyOn(adapter, "stopPolling");
    const { unmount } = renderHook(() => useCalendarLiveInbound(adapter));
    expect(startPolling).toHaveBeenLastCalledWith(CALENDAR_BACKGROUND_POLL_MS);

    act(() => {
      hub.connected = true;
      for (const listener of hub.statusListeners) listener();
    });
    expect(startPolling).toHaveBeenLastCalledWith(CALENDAR_PUSH_POLL_MS);

    act(() => {
      hub.connected = false;
      for (const listener of hub.statusListeners) listener();
    });
    expect(startPolling).toHaveBeenLastCalledWith(CALENDAR_BACKGROUND_POLL_MS);

    unmount();
    expect(stopPolling).toHaveBeenCalled();
  });
});
