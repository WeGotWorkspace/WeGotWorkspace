import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import { useTasksProjectMutations } from "@/tasks-core/src/use-tasks-project-mutations";
import { useTasksShell } from "@/tasks-core/src/use-tasks-shell";

const bootstrap = createTasksAppBootstrap();

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function renderProjectMutations(
  operations?: ReturnType<typeof useTasksShell> extends never
    ? never
    : Parameters<typeof useTasksShell>[0]["operations"],
  initialView?: string,
) {
  const { result: shellResult } = renderHook(() =>
    useTasksShell({
      data: bootstrap.data,
      operations,
      initialView,
    }),
  );

  const { result, rerender } = renderHook(({ shell }) => useTasksProjectMutations({ shell }), {
    initialProps: { shell: shellResult.current },
  });

  rerender({ shell: shellResult.current });

  return { result, shell: shellResult };
}

describe("useTasksProjectMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("canManageProjects requires create and patch list operations", () => {
    const { result } = renderProjectMutations({
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList: vi.fn(),
      patchTaskList: vi.fn(),
    });

    expect(result.current.canManageProjects).toBe(true);
  });

  it("createProject appends list and navigates to it", async () => {
    const created = {
      "@type": "TaskList" as const,
      id: "list-new",
      name: "Launch",
      color: "#6366f1",
      isDefault: false,
    };
    const createTaskList = vi.fn().mockResolvedValue(created);
    const { result, shell } = renderProjectMutations({
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList,
      patchTaskList: vi.fn(),
    });

    await act(async () => {
      await result.current.createProject({
        name: "Launch",
        color: "#6366f1",
        groupSlug: null,
      });
    });

    expect(createTaskList).toHaveBeenCalledWith({
      name: "Launch",
      color: "#6366f1",
    });
    expect(shell.current.taskLists.some((list) => list.id === "list-new")).toBe(true);
    expect(shell.current.view).toBe("list:list-new");
    expect(result.current.projectDialog).toBe(null);
  });

  it("createProject forwards groupSlug to the API", async () => {
    const createTaskList = vi.fn().mockResolvedValue({
      "@type": "TaskList" as const,
      id: "roadmap",
      name: "Roadmap",
      color: "#22c55e",
      scope: "group",
      groupSlug: "team",
      isDefault: false,
    });
    const { result } = renderProjectMutations({
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList,
      patchTaskList: vi.fn(),
    });

    await act(async () => {
      await result.current.createProject({
        name: "Roadmap",
        color: "#22c55e",
        groupSlug: "team",
      });
    });

    expect(createTaskList).toHaveBeenCalledWith({
      name: "Roadmap",
      color: "#22c55e",
      groupSlug: "team",
    });
  });

  it("updateProject forwards groupSlug when changing owner", async () => {
    const patchTaskList = vi.fn().mockResolvedValue({
      "@type": "TaskList" as const,
      id: "work",
      name: "Work",
      color: "#f59e0b",
      scope: "group",
      groupSlug: "team",
      isDefault: false,
    });
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList,
      },
      "list:work",
    );

    act(() => {
      result.current.openEditProjectDialog("work");
    });
    expect(result.current.projectDialog).toMatchObject({
      mode: "edit",
      listId: "work",
      canChangeOwner: true,
      mayDelete: false,
    });

    await act(async () => {
      await result.current.updateProject("work", {
        name: "Work",
        color: "#f59e0b",
        groupSlug: "team",
      });
    });

    expect(patchTaskList).toHaveBeenCalledWith("work", {
      groupSlug: "team",
    });
  });

  it("updateProject omits groupSlug when the owner is unchanged", async () => {
    const patchTaskList = vi.fn().mockResolvedValue({
      "@type": "TaskList" as const,
      id: "work",
      name: "Client work",
      color: "#22c55e",
      isDefault: false,
    });
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList,
      },
      "list:work",
    );

    await act(async () => {
      await result.current.updateProject("work", {
        name: "Client work",
        color: "#22c55e",
        groupSlug: null,
      });
    });

    expect(patchTaskList).toHaveBeenCalledWith("work", {
      name: "Client work",
      color: "#22c55e",
    });
    expect(patchTaskList.mock.calls[0]?.[1]).not.toHaveProperty("groupSlug");
  });

  it("updateProject patches name and color", async () => {
    const patchTaskList = vi.fn().mockResolvedValue({
      "@type": "TaskList" as const,
      id: "default",
      name: "Client work",
      color: "#22c55e",
      isDefault: false,
    });
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList,
      },
      "list:default",
    );

    await act(async () => {
      await result.current.updateProject("default", {
        name: "Client work",
        color: "#22c55e",
      });
    });

    expect(patchTaskList).toHaveBeenCalledWith("default", {
      name: "Client work",
      color: "#22c55e",
    });
    expect(result.current.projectDialog).toBe(null);
  });

  it("updateProject patches inbox name and color", async () => {
    const patchTaskList = vi.fn().mockResolvedValue({
      "@type": "TaskList" as const,
      id: "inbox",
      name: "Capture",
      color: "#22c55e",
      role: "inbox",
      isDefault: true,
    });
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList,
      },
      "list:inbox",
    );

    await act(async () => {
      await result.current.updateProject("inbox", {
        name: "Capture",
        color: "#ec4899",
      });
    });

    expect(patchTaskList).toHaveBeenCalledWith("inbox", {
      name: "Capture",
      color: "#ec4899",
    });
  });

  it("updateProject skips unchanged payloads", async () => {
    const patchTaskList = vi.fn();
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList,
      },
      "list:inbox",
    );

    await act(async () => {
      await result.current.updateProject("inbox", {
        name: "Inbox",
        color: null,
      });
    });

    expect(patchTaskList).not.toHaveBeenCalled();
  });

  it("openEditProjectDialog offers owner delete for an owned custom list", () => {
    const { result } = renderProjectMutations({
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList: vi.fn(),
      patchTaskList: vi.fn(),
      deleteTaskList: vi.fn(),
    });

    act(() => {
      result.current.openEditProjectDialog("work");
    });

    expect(result.current.projectDialog).toMatchObject({
      mode: "edit",
      listId: "work",
      mayDelete: true,
      isSharee: false,
    });
  });

  it("openEditProjectDialog hides owner delete for inbox and provisioned group lists", () => {
    const data = {
      ...bootstrap.data,
      taskLists: [
        ...bootstrap.data.taskLists,
        {
          ...bootstrap.data.taskLists[1],
          id: "group-team",
          name: "Team standup",
          role: "group",
          scope: "group",
          groupSlug: "team",
          isDefault: false,
          isSharee: false,
          myRights: {
            ...bootstrap.data.taskLists[1].myRights,
            mayDelete: false,
            mayShare: true,
          },
        },
      ],
    };
    const operations = {
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList: vi.fn(),
      patchTaskList: vi.fn(),
      deleteTaskList: vi.fn(),
    };
    const { result: shellResult } = renderHook(() =>
      useTasksShell({
        data,
        operations,
      }),
    );
    const { result } = renderHook(({ shell }) => useTasksProjectMutations({ shell }), {
      initialProps: { shell: shellResult.current },
    });

    act(() => {
      result.current.openEditProjectDialog("inbox");
    });
    expect(result.current.projectDialog).toMatchObject({
      listId: "inbox",
      mayDelete: false,
    });

    act(() => {
      result.current.openEditProjectDialog("group-team");
    });
    expect(result.current.projectDialog).toMatchObject({
      listId: "group-team",
      mayDelete: false,
      canChangeOwner: false,
    });
  });

  it("deleteList removes an owned custom list and its tasks", async () => {
    const deleteTaskList = vi.fn().mockResolvedValue(undefined);
    const { result, shell } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList: vi.fn(),
        deleteTaskList,
      },
      "list:work",
    );

    await act(async () => {
      await result.current.deleteList("work");
    });

    expect(deleteTaskList).toHaveBeenCalledWith("work", { onDestroyRemoveContents: true });
    expect(shell.current.taskLists.some((list) => list.id === "work")).toBe(false);
    expect(shell.current.tasks.some((task) => task.taskListId === "work")).toBe(false);
    expect(shell.current.view).toBe("state:all");
    expect(result.current.projectDialog).toBe(null);
  });

  it("deleteList does not delete the owned inbox", async () => {
    const deleteTaskList = vi.fn();
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList: vi.fn(),
        deleteTaskList,
      },
      "list:inbox",
    );

    await act(async () => {
      await result.current.deleteList("inbox");
    });

    expect(deleteTaskList).not.toHaveBeenCalled();
  });

  it("removeSharedList dismisses a sharee list without touching owned inbox", async () => {
    const deleteTaskList = vi.fn().mockResolvedValue(undefined);
    const data = {
      ...bootstrap.data,
      taskLists: [
        ...bootstrap.data.taskLists,
        {
          ...bootstrap.data.taskLists[0],
          id: "shared-inbox",
          name: "Inbox",
          role: null,
          isDefault: false,
          isSharee: true,
        },
      ],
    };
    const operations = {
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList: vi.fn(),
      patchTaskList: vi.fn(),
      deleteTaskList,
    };
    const { result: shellResult } = renderHook(() =>
      useTasksShell({
        data,
        operations,
        initialView: "list:shared-inbox",
      }),
    );
    const { result } = renderHook(({ shell }) => useTasksProjectMutations({ shell }), {
      initialProps: { shell: shellResult.current },
    });

    await act(async () => {
      await result.current.removeSharedList("shared-inbox");
    });

    expect(deleteTaskList).toHaveBeenCalledWith("shared-inbox");
    expect(shellResult.current.taskLists.some((list) => list.id === "shared-inbox")).toBe(false);
    expect(shellResult.current.view).toBe("state:all");
  });

  it("removeSharedList does not delete the owned inbox", async () => {
    const deleteTaskList = vi.fn();
    const { result } = renderProjectMutations(
      {
        createTask: vi.fn(),
        patchTask: vi.fn(),
        deleteTask: vi.fn(),
        moveTaskToList: vi.fn(),
        createTaskList: vi.fn(),
        patchTaskList: vi.fn(),
        deleteTaskList,
      },
      "list:inbox",
    );

    await act(async () => {
      await result.current.removeSharedList("inbox");
    });

    expect(deleteTaskList).not.toHaveBeenCalled();
  });

  it("updateProject skips patch when implicit hash color is unchanged", async () => {
    const patchTaskList = vi.fn();
    const data = {
      ...bootstrap.data,
      taskLists: [
        ...bootstrap.data.taskLists,
        {
          ...bootstrap.data.taskLists[1],
          id: "roadmap",
          name: "Roadmap",
          color: null,
          isDefault: false,
        },
      ],
    };
    const operations = {
      createTask: vi.fn(),
      patchTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTaskToList: vi.fn(),
      createTaskList: vi.fn(),
      patchTaskList,
    };
    const { result: shellResult } = renderHook(() =>
      useTasksShell({
        data,
        operations,
        initialView: "list:roadmap",
      }),
    );
    const { result } = renderHook(({ shell }) => useTasksProjectMutations({ shell }), {
      initialProps: { shell: shellResult.current },
    });

    const displayColor = taskListDotColor({ id: "roadmap", color: null });

    await act(async () => {
      await result.current.updateProject("roadmap", {
        name: "Roadmap",
        color: displayColor,
      });
    });

    expect(patchTaskList).not.toHaveBeenCalled();
  });
});
