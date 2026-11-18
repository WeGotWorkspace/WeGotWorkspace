import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createThreadMemoryClient } from "@/thread-ui/src/thread-memory-client";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadSubjectAdapter,
} from "@/lib/models/thread-types";
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
});
