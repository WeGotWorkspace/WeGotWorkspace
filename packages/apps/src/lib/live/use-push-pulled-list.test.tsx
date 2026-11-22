/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { JmapPushHubLike } from "@/lib/api/wgw/use-jmap-state-change";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import {
  PUSH_PULLED_MAX_CHANGE_PAGES,
  pullChangesPages,
  usePushPulledList,
  type PushPulledChangesPage,
  type PushPulledListClient,
} from "./use-push-pulled-list";

/** A non-Docs item, to show the pull needs nothing from Docs. */
type TaskComment = { id: string; taskId: string; body: string };

function page(newState: string, created: string[], hasMoreChanges = false): PushPulledChangesPage {
  return { newState, created, updated: [], destroyed: [], hasMoreChanges };
}

describe("pullChangesPages", () => {
  it("follows hasMoreChanges and reloads once", async () => {
    const changes = vi
      .fn<(since: string | null) => Promise<PushPulledChangesPage>>()
      .mockResolvedValueOnce(page("2", [], true))
      .mockResolvedValueOnce(page("3", ["c1"], true))
      .mockResolvedValueOnce(page("4", []));
    const reload = vi.fn(async () => undefined);

    await expect(pullChangesPages(changes, "1", reload)).resolves.toEqual({
      state: "4",
      complete: true,
    });
    expect(changes.mock.calls.map(([since]) => since)).toEqual(["1", "2", "3"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops at the page cap and answers incomplete", async () => {
    let state = 0;
    const changes = vi.fn(async () => page(String(++state), [], true));
    const reload = vi.fn(async () => undefined);

    await expect(pullChangesPages(changes, "0", reload)).resolves.toEqual({
      state: String(PUSH_PULLED_MAX_CHANGE_PAGES),
      complete: false,
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("resyncs with a fresh state and a full reload when the state expired", async () => {
    const changes = vi
      .fn<(since: string | null) => Promise<PushPulledChangesPage>>()
      .mockRejectedValueOnce(new WgwRequestError("expired", 400, "cannotCalculateChanges"))
      .mockResolvedValueOnce(page("9", []));
    const reload = vi.fn(async () => undefined);

    await expect(pullChangesPages(changes, "1", reload)).resolves.toEqual({
      state: "9",
      complete: true,
    });
    expect(changes.mock.calls.map(([since]) => since)).toEqual(["1", null]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("rejects other failures so the caller keeps its state", async () => {
    const changes = vi.fn(async () => {
      throw new WgwRequestError("down", 503);
    });
    await expect(pullChangesPages(changes, "1", vi.fn())).rejects.toThrow("down");
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

function fakePushHub() {
  const listeners: Array<{ types: readonly string[]; listener: StateChangeListener }> = [];
  const hub: JmapPushHubLike = {
    connected: true,
    subscribe: (types, listener) => {
      const entry = { types, listener };
      listeners.push(entry);
      return () => {
        listeners.splice(listeners.indexOf(entry), 1);
      };
    },
    subscribeStatus: () => () => undefined,
  };
  return {
    hub,
    ring: (type: string, state: string) =>
      Promise.all(
        listeners
          .filter((entry) => entry.types.includes(type))
          .map((entry) => entry.listener({ [type]: state }, "bob")),
      ),
  };
}

describe("usePushPulledList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pulls a declared push type for any item type", async () => {
    const comments: TaskComment[] = [{ id: "c1", taskId: "t1", body: "first" }];
    let state = 1;
    const client: PushPulledListClient<TaskComment> = {
      list: vi.fn(async () => [...comments]),
      changes: vi.fn(async () => page(String(state), state > 1 ? ["c2"] : [])),
    };
    const push = fakePushHub();
    const { result } = renderHook(() =>
      usePushPulledList<TaskComment>({
        client,
        scope: "t1",
        live: true,
        pushType: "TaskComment",
        pollMs: 4_000,
        pushHub: push.hub,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loaded).toBe(true);
    expect(result.current.items.map((item) => item.id)).toEqual(["c1"]);

    // Push is connected: no backup poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(client.changes).not.toHaveBeenCalled();

    // Another push type does not ring this list.
    await act(async () => {
      await push.ring("DocThread", "x");
    });
    expect(client.changes).not.toHaveBeenCalled();

    await act(async () => {
      await push.ring("TaskComment", "a");
    });
    comments.push({ id: "c2", taskId: "t1", body: "second" });
    state = 2;
    let answers: Array<boolean | void> = [];
    await act(async () => {
      answers = await push.ring("TaskComment", "b");
    });
    expect(answers).toEqual([true]);
    expect(vi.mocked(client.changes).mock.calls.map(([, since]) => since)).toEqual([null, "1"]);
    expect(result.current.items.map((item) => item.id)).toEqual(["c1", "c2"]);
  });
});
