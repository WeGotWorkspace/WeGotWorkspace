import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { taskTextHold } from "@/tasks-core/src/task-text-session";
import { useTaskDetailLiveText } from "@/tasks-core/src/use-task-detail-live-text";

const parkTask = vi.fn(async () => {});
vi.mock("@/lib/offline/tasks/tasks-parked-writes", () => ({
  parkTask: (...args: unknown[]) => parkTask(...(args as [])),
}));
const room = { accessLost: false };
vi.mock("@/tasks-core/src/use-task-text-collab", () => ({
  useTaskTextCollab: () => ({ collab: undefined, accessLost: room.accessLost }),
}));

const task = { id: "t1.ics", title: "Buy milk", description: "", taskListId: "home" } as Task;
const lists = [{ id: "home", name: "Home" }] as TaskList[];

function renderLive() {
  const showLiveText = vi.fn();
  const hook = renderHook(() =>
    useTaskDetailLiveText({
      task,
      taskLists: lists,
      username: "anna",
      displayName: "Anna",
      showLiveText,
    }),
  );
  return { ...hook, showLiveText };
}

describe("useTaskDetailLiveText", () => {
  beforeEach(() => {
    parkTask.mockClear();
    room.accessLost = false;
  });

  it("shows the room's text in the list row", () => {
    const { result, showLiveText } = renderLive();
    act(() => result.current.onLiveText("t1.ics", { title: "Buy oat", description: "" }, true));
    expect(showLiveText).toHaveBeenCalledWith("t1.ics", { title: "Buy oat", description: "" });
  });

  it("parks unsaved text when access is lost", () => {
    const { result, rerender } = renderLive();
    act(() => result.current.onLiveText("t1.ics", { title: "Buy oat", description: "x" }, true));
    room.accessLost = true;
    rerender();

    expect(parkTask).toHaveBeenCalledTimes(1);
    expect(parkTask).toHaveBeenCalledWith(
      "anna",
      expect.objectContaining({ id: "t1.ics", title: "Buy oat", description: "x" }),
      { kind: "edit", reason: "gone", containerName: "Home" },
    );
  });

  it("parks nothing when the server already has the text", () => {
    const { result, rerender } = renderLive();
    act(() => result.current.onLiveText("t1.ics", { title: "Buy milk", description: "" }, false));
    room.accessLost = true;
    rerender();
    expect(parkTask).not.toHaveBeenCalled();
  });
});

describe("taskTextHold", () => {
  const L = defaultTasksLabels;
  it("holds a blank title and a field over its limit", () => {
    expect(taskTextHold({ title: " ", description: "" }, L)).toBe(L.liveTextTitleRequired);
    expect(taskTextHold({ title: "x".repeat(4097), description: "" }, L)).toBe(L.liveTextTooLong);
    expect(taskTextHold({ title: "x", description: "y".repeat(8193) }, L)).toBe(L.liveTextTooLong);
    expect(taskTextHold({ title: "x".repeat(4096), description: "y".repeat(8192) }, L)).toBeNull();
  });

  it("gives the header the open task's room only, and clears it when the room is left", () => {
    const { result } = renderLive();
    const source = { session: null, peers: [{ id: "1", name: "Bo" }] };
    expect(result.current.textPresence).toBeNull();

    act(() => result.current.onPresence("t1.ics", source));
    expect(result.current.textPresence).toBe(source);

    // Another task's room leaving does not clear the open one's.
    act(() => result.current.onPresence("other.ics", null));
    expect(result.current.textPresence).toBe(source);

    act(() => result.current.onPresence("t1.ics", null));
    expect(result.current.textPresence).toBeNull();

    act(() => result.current.onPresence("other.ics", source));
    expect(result.current.textPresence).toBeNull();
  });
});
