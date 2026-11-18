import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/models/tasks-types";
import { useTaskTextCollab } from "@/tasks-core/src/use-task-text-collab";

const lookup = vi.hoisted(() => ({
  settle: null as null | { resolve: (room: string) => void; reject: (error: Error) => void },
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwLiveApiEnabled: () => true,
  wgwEnsureFreshAccessToken: async () => "token",
}));

vi.mock("@/lib/api/wgw/tasks-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/tasks-text")>()),
  fetchTaskTextRoom: () =>
    new Promise<string>((resolve, reject) => {
      lookup.settle = { resolve, reject };
    }),
}));

const task = { id: "task-1", taskListId: "list-1", title: "Buy milk" } as Task;

function open() {
  return renderHook(() => useTaskTextCollab({ task, username: "anna", displayName: "Anna" }));
}

describe("useTaskTextCollab", () => {
  beforeEach(() => {
    lookup.settle = null;
  });

  it("holds the text while the room is looked up, then hands over the room", async () => {
    const { result } = open();
    expect(result.current.lookingUp).toBe(true);
    expect(result.current.collab).toBeUndefined();

    await act(async () => lookup.settle?.resolve("task:1:abc"));
    await waitFor(() => expect(result.current.collab).toBeDefined());
    expect(result.current.lookingUp).toBe(false);
    expect(result.current.collab?.urls.room).toBeTruthy();
  });

  it("gives the fields back to the autosave when there is no room", async () => {
    const { result } = open();
    expect(result.current.lookingUp).toBe(true);

    await act(async () => lookup.settle?.reject(new Error("offline")));
    await waitFor(() => expect(result.current.lookingUp).toBe(false));
    expect(result.current.collab).toBeUndefined();
  });
});
