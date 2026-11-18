import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createThreadMemoryClient } from "@/thread-ui/src/thread-memory-client";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadSubjectAdapter,
} from "@/lib/models/thread-types";
import "fake-indexeddb/auto";
import { readThreadCache } from "@/lib/offline/threads/thread-cache";
import { failureOf, useThread } from "@/thread-ui/src/use-thread";

const alice = { id: "alice", displayName: "Alice" };
const bob = { id: "bob", displayName: "Bob" };
const subject = { type: "note", id: "n1" };
const adapter: ThreadSubjectAdapter = {
  subject,
  scopeId: "s1",
  canPost: true,
  people: [alice, bob],
  me: alice,
};

describe("useThread", () => {
  it("posts a comment and a reply under the client ULID, with the scope the author saw", async () => {
    const client = createThreadMemoryClient(alice, [alice, bob]);
    const post = vi.spyOn(client, "post");
    const { result } = renderHook(() => useThread(client, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.post("Hi @bob", [{ id: "bob" }]));
    const root = result.current.roots[0]!.entry;
    await act(() => result.current.post("Answer", [], root.id));

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: "Hi @bob",
      scopeId: "s1",
      mentions: [{ id: "bob" }],
    });
    expect(post.mock.calls[0]?.[1].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.current.roots).toHaveLength(1);
    expect(result.current.roots[0]?.replies.map((reply) => reply.body)).toEqual(["Answer"]);
    expect(result.current.count).toBe(2);
    expect(root.pending).toBeUndefined();
  });

  it("keeps a comment that did not land as Not sent, with the reason, and a retry reuses its id", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    let fail: ThreadRequestError | null = new ThreadRequestError("moved", 409, "subject_moved");
    const client: ThreadClient = {
      ...memory,
      post: async (s, p) => {
        if (fail) throw fail;
        return memory.post(s, p);
      },
    };
    const { result } = renderHook(() => useThread(client, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.post("Offline thought", []));
    const failed = result.current.roots[0]!.entry;
    expect(failed.failed).toBe("moved");

    fail = null;
    await act(() => result.current.retry(failed.id));
    expect(result.current.roots[0]?.entry.id).toBe(failed.id);
    expect(result.current.roots[0]?.entry.failed).toBeUndefined();
    expect(memory.snapshot(subject)).toHaveLength(1);
  });

  it("maps server answers to the Not sent reasons", () => {
    expect(failureOf(new ThreadRequestError("x", 404))).toBe("gone");
    expect(failureOf(new ThreadRequestError("x", 403))).toBe("forbidden");
    expect(failureOf(new ThreadRequestError("x", 409, "subject_moved"))).toBe("moved");
    expect(failureOf(new ThreadRequestError("x", 422))).toBe("invalid");
    expect(failureOf(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("refetches only when /changes reports something", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    const list = vi.spyOn(memory, "list");
    const { result } = renderHook(() => useThread(memory, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(list).toHaveBeenCalledTimes(1);

    await act(() => result.current.refresh());
    expect(list).toHaveBeenCalledTimes(1);

    memory.receive(subject, {
      id: "01J6Y6M0R2V9GKJ4W1T8Q30001",
      kind: "comment",
      parentId: null,
      author: { username: "bob", displayName: "Bob" },
      body: "New",
      mentions: [],
      reactions: [],
      createdAt: "2026-11-18T12:00:00.000Z",
      editedAt: null,
      deletedAt: null,
      activity: null,
    });
    await act(() => result.current.refresh());
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.roots.map((root) => root.entry.body)).toEqual(["New"]);
  });

  it("cannot post when the server says so, even if the adapter could", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    memory.setCanPost(subject, false);
    const { result } = renderHook(() => useThread(memory, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.canPost).toBe(false);
  });

  it("is gone on 404, so the panel shows nothing of a subject the user cannot see", async () => {
    const memory = createThreadMemoryClient(alice);
    const client: ThreadClient = {
      ...memory,
      list: async () => {
        throw new ThreadRequestError("gone", 404, "not_found");
      },
    };
    const { result } = renderHook(() => useThread(client, adapter));
    await waitFor(() => expect(result.current.status).toBe("gone"));
  });

  const entry = (id: string, createdAt: string): ThreadEntry => ({
    id,
    kind: "comment",
    parentId: null,
    author: { username: "bob", displayName: "Bob" },
    body: id,
    mentions: [],
    reactions: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
    activity: null,
  });

  it("follows nextCursor so the newest entries show, and keeps a comment it just posted", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    const old = entry("A1", "2026-01-01T00:00:00.000Z");
    const newest = entry("A2", "2026-01-02T00:00:00.000Z");
    const list = vi.fn(async (_s: unknown, cursor?: string | null) => {
      const page = await memory.list(subject);
      return cursor
        ? { ...page, list: [newest, ...page.list], nextCursor: null }
        : { ...page, list: [old], nextCursor: "c2" };
    });
    const client: ThreadClient = { ...memory, list };
    const { result } = renderHook(() => useThread(client, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.roots.map((root) => root.entry.id)).toEqual(["A1", "A2"]);
    expect(list.mock.calls[1]?.[1]).toBe("c2");

    await act(() => result.current.post("Mine", []));
    await act(() => result.current.refresh());
    expect(result.current.roots.map((root) => root.entry.body)).toEqual(["A1", "A2", "Mine"]);
  });

  it("keeps a comment that landed while an older list was in flight", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    let release: (() => void) | null = null;
    let first = true;
    const client: ThreadClient = {
      ...memory,
      list: async (s, c, signal) => {
        const page = await memory.list(s, c, signal);
        if (first) {
          first = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return page;
      },
    };
    const { result } = renderHook(() => useThread(client, adapter));
    await act(() => result.current.post("Quick", []));
    await act(async () => release?.());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.roots.map((root) => root.entry.body)).toEqual(["Quick"]);
    // The state was not moved past the row, so the next poll still reloads.
    const list = vi.spyOn(client, "list");
    await act(() => result.current.refresh());
    expect(list).toHaveBeenCalled();
    expect(result.current.roots.map((root) => root.entry.body)).toEqual(["Quick"]);
  });

  it.each([
    ["a network error", new TypeError("Failed to fetch"), "network"],
    ["a 422", new ThreadRequestError("too long", 422, "invalidArguments"), "invalid"],
  ])("edit resolves false and reports the reason on %s", async (_name, error, reason) => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    memory.seed(subject, [{ ...entry("E1", "2026-01-01T00:00:00.000Z"), author: alice }] as never);
    const client: ThreadClient = {
      ...memory,
      edit: async () => {
        throw error;
      },
    };
    const { result } = renderHook(() => useThread(client, adapter));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let landed = true;
    await act(async () => {
      landed = await result.current.edit("E1", "New");
    });
    expect(landed).toBe(false);
    expect(result.current.writeError).toBe(reason);
    expect(result.current.roots[0]?.entry.body).toBe("E1");
  });

  it("shows the last fetched thread offline with its fetch time, and never-opened ones as offline", async () => {
    const memory = createThreadMemoryClient(alice, [alice, bob]);
    memory.seed({ type: "note", id: "cached" }, [entry("K1", "2026-01-01T00:00:00.000Z")]);
    const cachedAdapter = { ...adapter, subject: { type: "note", id: "cached" } };
    const online = renderHook(() => useThread(memory, cachedAdapter));
    await waitFor(() => expect(online.result.current.status).toBe("ready"));
    await waitFor(async () =>
      expect(await readThreadCache("alice", cachedAdapter.subject)).not.toBeNull(),
    );
    online.unmount();

    const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      const down: ThreadClient = {
        ...memory,
        list: async () => {
          throw new TypeError("Failed to fetch");
        },
      };
      const cached = renderHook(() => useThread(down, cachedAdapter));
      await waitFor(() => expect(cached.result.current.status).toBe("ready"));
      expect(cached.result.current.roots.map((root) => root.entry.id)).toEqual(["K1"]);
      expect(cached.result.current.lastUpdated).toEqual(expect.any(Number));

      const never = renderHook(() =>
        useThread(down, { ...adapter, subject: { type: "note", id: "never" } }),
      );
      await waitFor(() => expect(never.result.current.status).toBe("offline"));
      expect(never.result.current.lastUpdated).toBeNull();
    } finally {
      offline.mockRestore();
    }
  });
});
