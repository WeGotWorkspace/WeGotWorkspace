import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createSharedTasksLists } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { defaultTaskListId } from "@/tasks-core/src/tasks-task-utils";
import {
  isOwnedInboxSidebarList,
  isViewOnlyTaskList,
  useTasksSidebarModel,
} from "@/tasks-core/src/use-tasks-sidebar-model";

const writeRights = { mayWriteAll: true, mayShare: true };
const groupMemberRights = { mayWriteAll: true, mayShare: false };
const viewOnlyRights = { mayWriteAll: false, mayShare: false };

describe("useTasksSidebarModel", () => {
  it("keeps a group member who cannot share in My lists and puts shared Inbox under Shared with me", () => {
    const { result } = renderHook(() =>
      useTasksSidebarModel({
        labels: defaultTasksLabels,
        view: "state:all",
        taskLists: [
          {
            id: "inbox",
            name: "Inbox",
            role: "inbox",
            isSharee: false,
            isDefault: true,
            myRights: writeRights,
          },
          {
            id: "group-team",
            name: "Team standup",
            isSharee: false,
            myRights: groupMemberRights,
          },
          {
            id: "shared-inbox",
            name: "Inbox",
            isSharee: true,
            isDefault: false,
            myRights: viewOnlyRights,
          },
        ],
        selectView: () => undefined,
      }),
    );

    expect(result.current.ownedLists.map((list) => list.id)).toEqual(["inbox", "group-team"]);
    expect(result.current.sharedLists.map((list) => list.id)).toEqual(["shared-inbox"]);
    expect(result.current.ownInboxId).toBe("inbox");
    expect(defaultTaskListId(result.current.ownedLists.concat(result.current.sharedLists))).toBe(
      "inbox",
    );
  });

  it("starts the top nav with All Lists and keeps time filters", () => {
    const { result } = renderHook(() =>
      useTasksSidebarModel({
        labels: defaultTasksLabels,
        view: "state:all",
        taskLists: [],
        selectView: () => undefined,
      }),
    );

    expect(result.current.topSidebarItems.map((item) => item.label)).toEqual([
      defaultTasksLabels.stateAll,
      defaultTasksLabels.stateToday,
      defaultTasksLabels.stateUpcoming,
      defaultTasksLabels.stateOverdue,
    ]);
  });

  it("lists none alongside high, medium, and low in Priority", () => {
    const { result } = renderHook(() =>
      useTasksSidebarModel({
        labels: defaultTasksLabels,
        view: "priority:none",
        taskLists: [],
        selectView: () => undefined,
      }),
    );

    expect(result.current.prioritySidebarItems.map((item) => item.label)).toEqual([
      defaultTasksLabels.priorityHigh,
      defaultTasksLabels.priorityMedium,
      defaultTasksLabels.priorityLow,
      defaultTasksLabels.priorityNone,
    ]);
    expect(result.current.prioritySidebarItems.at(-1)?.selected).toBe(true);
  });

  it("does not treat a display name Inbox as the owned inbox", () => {
    const namedInbox = {
      id: "custom",
      name: "Inbox",
      isSharee: false,
      myRights: writeRights,
    };
    expect(isOwnedInboxSidebarList(namedInbox)).toBe(false);
    expect(
      isOwnedInboxSidebarList({
        id: "shared-inbox",
        name: "Inbox",
        role: "inbox",
        isSharee: true,
      }),
    ).toBe(false);
  });

  it("marks inbound read shares as view-only", () => {
    expect(isViewOnlyTaskList({ id: "shared", name: "Shared", myRights: viewOnlyRights })).toBe(
      true,
    );
    expect(isViewOnlyTaskList({ id: "owned", name: "Owned", myRights: writeRights })).toBe(false);
  });

  it("partitions the shared mock fixture the same way", () => {
    const lists = createSharedTasksLists();
    const { result } = renderHook(() =>
      useTasksSidebarModel({
        labels: defaultTasksLabels,
        view: "state:all",
        taskLists: lists,
        selectView: () => undefined,
      }),
    );

    expect(result.current.ownedLists.some((list) => list.id === "group-team")).toBe(true);
    expect(result.current.sharedLists.some((list) => list.id === "shared-inbox")).toBe(true);
    expect(result.current.ownInboxId).toBe("inbox");
    expect(defaultTaskListId(lists)).toBe("inbox");
  });
});
