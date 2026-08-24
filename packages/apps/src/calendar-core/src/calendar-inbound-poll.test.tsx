import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarApiSource } from "@/calendar-core/src/calendar-api-source";
import type { CalendarAPIOperations, CalendarUIData } from "@/calendar-core/src/calendar-types";
import { useCalendarAPI } from "@/calendar-core/src/use-calendar-api";
import { useCalendarSurface } from "@/calendar-core/src/use-calendar-surface";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapInvocation } from "@/lib/jmap-client/core/types";
import { JmapClient } from "@/lib/jmap-client";
import { workCalendar } from "@/lib/jmap-client/mock/fixtures";
import { MockJmapServer } from "@/lib/jmap-client/mock/MockJmapServer";

const here = dirname(fileURLToPath(import.meta.url));

const bootstrap = createCalendarAppBootstrap();
bootstrap.session = {
  ...mockWorkspaceSession,
  user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
};

const mockPatchBootstrap = vi.fn();
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: vi.fn(),
    successVersion: 1,
    patchBootstrap: mockPatchBootstrap,
  }),
}));

vi.mock("@/lib/offline/calendars-hybrid-operations", () => ({
  createHybridCalendarOperations: vi.fn(),
  getCalendarsSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/calendars-offline-store", () => ({
  readCalendarBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => true,
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwAwaitSessionRefreshForReconnect: vi.fn(async () => undefined),
  wgwLiveApiEnabled: vi.fn(() => false),
}));

function operationsStub(): CalendarAPIOperations {
  return {
    createEvent: vi.fn(),
    patchEvent: vi.fn(),
    deleteEvent: vi.fn(),
  };
}

const data: CalendarUIData = {
  calendars: [{ id: "cal-work", name: "Work", color: "#3366cc", isDefault: true }],
  events: [],
};

function countMethod(methods: string[], name: string): number {
  return methods.filter((method) => method === name).length;
}

describe("calendar inbound poll call-count", () => {
  beforeEach(() => {
    // Only fake the poll interval — initialize/sync use promise fetch.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    mockPatchBootstrap.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue({ conflicts: [], schedulingConflicts: [], bootstrap: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("after two poll intervals runs exactly one inbound /changes series; hybrid has no interval", async () => {
    const apiSource = readFileSync(join(here, "use-calendar-api.ts"), "utf8");
    expect(apiSource).not.toContain("setInterval");
    expect(apiSource).not.toContain("CALENDAR_BACKGROUND_POLL_MS");

    const server = new MockJmapServer();
    server.seedCalendar(workCalendar);
    const methods: string[] = [];
    const inner = server.fetch;
    const client = new JmapClient({
      sessionUrl: server.sessionUrl,
      fetch: async (input, init) => {
        if (init?.body) {
          const request = JSON.parse(String(init.body)) as { methodCalls: JmapInvocation[] };
          for (const [name] of request.methodCalls) methods.push(name);
        }
        return inner(input, init);
      },
    });

    const loadBootstrap = vi.fn(async () => bootstrap);
    const source: CalendarApiSource = {
      loadBootstrap,
      createOperations: () => undefined,
      createJmapClient: () => client,
    };

    const { unmount } = renderHook(() => {
      const api = useCalendarAPI(source);
      useCalendarSurface(api.jmapClient, data, "ada@example.com", {
        operations: operationsStub(),
      });
      return api;
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(methods).toContain("CalendarEvent/query");
      });
      await Promise.resolve();
    });

    const changesAfterInit = countMethod(methods, "CalendarEvent/changes");
    const bootstrapAfterInit = loadBootstrap.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS);
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS);
    });

    // One inbound poller: two interval ticks → two /changes. Hybrid has no second series.
    expect(countMethod(methods, "CalendarEvent/changes") - changesAfterInit).toBe(2);
    expect(loadBootstrap.mock.calls.length - bootstrapAfterInit).toBe(0);

    unmount();
  });
});
