import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { TaskList, TasksAPIOperations } from "@/lib/models/tasks-types";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import {
  canChangeTaskListOwner,
  canDeleteTaskList,
  isProjectOwnedTaskList,
} from "@/tasks-core/src/tasks-task-utils";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { useTasksController } from "@/tasks-core/src/use-tasks-controller";
import {
  projectCreateListId,
  tasksInProjectLists,
  tasksViewOutsideProject,
} from "@/tasks-core/src/use-tasks-project-scope";

let selectedProjectId: string | null = null;
vi.mock("@/lib/projects/use-project-filter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects/use-project-filter")>()),
  useSelectedProjectId: () => selectedProjectId,
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));
vi.mock("@/hooks/use-queued-mutation", () => ({
  useQueuedMutation: () => ({ queueMutation: vi.fn(), undoLatest: vi.fn(() => false) }),
}));
vi.mock("@/app-switch-button/src/app-switch-button", () => ({ AppSwitchButton: () => null }));
vi.mock("@/app-rail/src/app-rail", () => ({ AppRail: () => null }));

const PROJECT = "proj-website";

// "Work" is the Project's list: the server sends its projectId and mayRename false.
function projectBootstrap() {
  const base = createTasksAppBootstrap();
  const taskLists = base.data.taskLists.map((list): TaskList =>
    list.id === "work"
      ? { ...list, projectId: PROJECT, myRights: { ...list.myRights, mayRename: false } }
      : { ...list, projectId: null },
  );
  return { ...base, data: { ...base.data, taskLists } };
}

const operations = {
  createTask: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTaskToList: vi.fn(),
  createTaskList: vi.fn(),
  patchTaskList: vi.fn(),
  deleteTaskList: vi.fn(),
} satisfies TasksAPIOperations;

beforeEach(() => {
  cleanup();
  selectedProjectId = null;
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  selectedProjectId = null;
});

describe("Tasks project scope helpers", () => {
  const lists = [{ id: "work" }];

  it("keeps every task for All Projects and only the Project's tasks otherwise", () => {
    const { tasks } = projectBootstrap().data;
    expect(tasksInProjectLists(tasks, null)).toBe(tasks);
    const narrowed = tasksInProjectLists(tasks, lists);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.every((task) => task.taskListId === "work")).toBe(true);
  });

  it("moves an open list outside the Project to the Project's list", () => {
    const all = [{ id: "inbox" }, { id: "work" }];
    expect(tasksViewOutsideProject("list:inbox", all, lists)).toBe("list:work");
    expect(tasksViewOutsideProject("list:work", all, lists)).toBeNull();
    expect(tasksViewOutsideProject("state:today", all, lists)).toBeNull();
    expect(tasksViewOutsideProject("list:inbox", all, null)).toBeNull();
    // A list not loaded yet stays: it may still arrive.
    expect(tasksViewOutsideProject("list:later", all, lists)).toBeNull();
    expect(tasksViewOutsideProject("list:inbox", all, [])).toBe("state:all");
  });

  it("picks the Project's writable list for new tasks", () => {
    expect(projectCreateListId(null)).toBeNull();
    expect(
      projectCreateListId([
        { id: "ro", myRights: { mayWriteAll: false } as TaskList["myRights"] },
        { id: "rw", myRights: { mayWriteAll: true } as TaskList["myRights"] },
      ]),
    ).toBe("rw");
  });

  it("locks rename, owner change and delete on a Project list's owner side", () => {
    const list = { id: "work", projectId: PROJECT, myRights: { mayDelete: true, mayShare: true } };
    expect(isProjectOwnedTaskList(list)).toBe(true);
    expect(isProjectOwnedTaskList({ id: "x", myRights: { mayRename: false } })).toBe(true);
    expect(isProjectOwnedTaskList({ ...list, isSharee: true })).toBe(false);
    expect(isProjectOwnedTaskList({ id: "x", projectId: null })).toBe(false);
    expect(canDeleteTaskList(list)).toBe(false);
    expect(canChangeTaskListOwner(list)).toBe(false);
  });
});

describe("useTasksController with the Project filter", () => {
  it("lists every list and task under All Projects", () => {
    const { data } = projectBootstrap();
    const { result } = renderHook(() =>
      useTasksController({ data, operations, initialView: "state:all" }),
    );
    expect(result.current.taskLists).toHaveLength(data.taskLists.length);
    expect(result.current.visibleTasks.some((task) => task.taskListId !== "work")).toBe(true);
    expect(result.current.canManageProjects).toBe(true);
  });

  it("narrows lists and smart views to the Project and defaults new tasks into it", () => {
    selectedProjectId = PROJECT;
    const { data } = projectBootstrap();
    const { result } = renderHook(() =>
      useTasksController({ data, operations, initialView: "state:all" }),
    );
    expect(result.current.taskLists.map((list) => list.id)).toEqual(["work"]);
    expect(result.current.visibleTasks.length).toBeGreaterThan(0);
    expect(result.current.visibleTasks.every((task) => task.taskListId === "work")).toBe(true);
    expect(result.current.createListId).toBe("work");
    // "New list" is hidden while a Project is selected.
    expect(result.current.canManageProjects).toBe(false);
  });

  it("leaves a list outside the Project for the Project's list", async () => {
    selectedProjectId = PROJECT;
    const { data } = projectBootstrap();
    const { result } = renderHook(() =>
      useTasksController({ data, operations, initialView: "list:default" }),
    );
    await waitFor(() => expect(result.current.view).toBe("list:work"));
  });
});

describe("TasksWorkspace with the Project filter", () => {
  function renderWorkspace() {
    const { data, session } = projectBootstrap();
    return render(
      <TasksWorkspace
        data={data}
        session={session}
        operations={operations}
        initialView="state:all"
      />,
    );
  }

  /** The sidebar row of a list, by its name. */
  function sidebarRow(name: string): HTMLElement {
    const row = screen
      .getAllByText(name)
      .map((node) => node.closest("li"))
      .find(
        (li): li is HTMLLIElement => li?.querySelector(".collection-sidebar-row__name") != null,
      );
    if (!row) throw new Error(`no sidebar row for ${name}`);
    return row;
  }

  function hasPencil(row: HTMLElement): boolean {
    return within(row).queryByRole("button", { name: L.editList, hidden: true }) !== null;
  }

  it("shows the edit pencil on ordinary lists but not on the Project's list", () => {
    renderWorkspace();
    expect(hasPencil(sidebarRow("Personal"))).toBe(true);
    expect(hasPencil(sidebarRow("Work"))).toBe(false);
  });

  it("lists only the Project's list and its tasks while a Project is selected", () => {
    selectedProjectId = PROJECT;
    renderWorkspace();
    expect(hasPencil(sidebarRow("Work"))).toBe(false);
    expect(document.querySelectorAll(".collection-sidebar-row__name")).toHaveLength(1);
    expect(screen.getByText("Review API spec")).toBeTruthy();
    expect(screen.queryByText("Buy milk")).toBeNull();
  });
});
