/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocsThreadsRequestError } from "./docs-threads-errors";
import type { DocsFileThread, DocsThreadsClient } from "./docs-threads-types";
import { DOCS_THREADS_POLL_MS, useDocsThreadsSource } from "./use-docs-threads-source";

const PATH = "/users/bob/docs/plan.md";

function thread(id: string): DocsFileThread {
  return {
    id,
    kind: "comment",
    path: PATH,
    changeId: null,
    anchorText: "plan",
    anchorFrom: null,
    anchorTo: null,
    anchorOccurrence: null,
    createdAt: `2026-11-08T00:00:0${id.length}Z`,
    createdBy: { id: "bob", name: "Bob" },
    resolved: false,
    archived: false,
    messages: [],
    reactions: [],
  };
}

/**
 * A `/files/threads` server that hands out sync states and forgets all of
 * them on `reset()`, like a server whose thread store was rebuilt.
 */
function createThreadsServer() {
  const threads = new Map<string, { thread: DocsFileThread; changedAt: number }>();
  const knownStates = new Set<string>();
  let counter = 0;
  const server = {
    failList: false,
    add(id: string) {
      counter += 1;
      threads.set(id, { thread: thread(id), changedAt: counter });
    },
    reset() {
      knownStates.clear();
    },
    client: {
      list: vi.fn(async () => {
        if (server.failList) throw new DocsThreadsRequestError("GET /files/threads failed", 500);
        return [...threads.values()].map((entry) => entry.thread);
      }),
      changes: vi.fn(async (_path: string, since?: string | null) => {
        if (since && !knownStates.has(since)) {
          throw new DocsThreadsRequestError(
            "GET /files/threads/changes failed (400)",
            400,
            "cannotCalculateChanges",
          );
        }
        const after = since ? Number(since) : 0;
        const newState = String(counter);
        knownStates.add(newState);
        return {
          oldState: since ?? "0",
          newState,
          created: [...threads.entries()]
            .filter(([, entry]) => entry.changedAt > after)
            .map(([id]) => id),
          updated: [],
          destroyed: [],
          hasMoreChanges: false,
        };
      }),
      create: vi.fn(),
      reply: vi.fn(),
      react: vi.fn(),
      patch: vi.fn(),
    } satisfies DocsThreadsClient,
  };
  return server;
}

async function polls(count: number) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCS_THREADS_POLL_MS);
    });
  }
}

async function mountSynced(server: ReturnType<typeof createThreadsServer>) {
  const hook = renderHook(() =>
    useDocsThreadsSource({ client: server.client, path: PATH, poll: true }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  // First poll stores a sync state; the second runs on it.
  await polls(2);
  return hook;
}

const ids = (threads: DocsFileThread[]) => threads.map((item) => item.id);

describe("useDocsThreadsSource after an expired sync state (#1930)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops the stale state and shows comments added after the reset", async () => {
    const server = createThreadsServer();
    server.add("t1");
    const { result } = await mountSynced(server);
    expect(ids(result.current.fileThreads)).toEqual(["t1"]);

    server.reset();
    server.add("t22");
    await polls(3);

    expect(ids(result.current.fileThreads)).toEqual(["t1", "t22"]);

    // The fresh state keeps working: a later comment arrives on a normal poll.
    server.add("t333");
    await polls(1);
    expect(ids(result.current.fileThreads)).toEqual(["t1", "t22", "t333"]);
  });

  it("reports a failed resync instead of swallowing it, and recovers later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = createThreadsServer();
    server.add("t1");
    const { result } = await mountSynced(server);

    server.reset();
    server.add("t22");
    server.failList = true;
    await polls(2);

    expect(warn).toHaveBeenCalledWith(
      "[docs-threads] full reload after an expired sync state failed",
      expect.any(DocsThreadsRequestError),
    );
    expect(ids(result.current.fileThreads)).toEqual(["t1"]);

    server.failList = false;
    await polls(1);
    expect(ids(result.current.fileThreads)).toEqual(["t1", "t22"]);
  });

  it("keeps other poll errors quiet and retries them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = createThreadsServer();
    server.add("t1");
    const { result } = await mountSynced(server);

    server.client.changes.mockRejectedValueOnce(
      new DocsThreadsRequestError("GET /files/threads/changes failed (503)", 503),
    );
    server.add("t22");
    await polls(2);

    expect(warn).not.toHaveBeenCalled();
    expect(ids(result.current.fileThreads)).toEqual(["t1", "t22"]);
  });
});
