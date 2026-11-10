import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { filterTasksBySearch } from "@/tasks-core/src/tasks-task-utils";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-queued-mutation", () => ({
  useQueuedMutation: () => ({
    queueMutation: vi.fn(),
    undoLatest: vi.fn(() => false),
  }),
}));

vi.mock("@/app-switch-button/src/app-switch-button", () => ({
  AppSwitchButton: () => null,
}));

const bootstrap = createTasksAppBootstrap();

function renderWorkspace() {
  return render(
    <TasksWorkspace data={bootstrap.data} session={bootstrap.session} initialView="state:all" />,
  );
}

describe("TasksWorkspace", () => {
  beforeEach(() => {
    cleanup();
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

  it("reveals completed rows when the show-completed toggle is pressed", () => {
    renderWorkspace();

    const toggle = screen.getByRole("button", { name: defaultTasksLabels.showCompletedTasks });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Ship v0.9")).toBeNull();

    fireEvent.click(toggle);

    const pressed = screen.getByRole("button", { name: defaultTasksLabels.hideCompletedTasks });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.className).toContain("icon-button--active");
    expect(screen.getByText("Ship v0.9")).toBeTruthy();
  });

  it("opens a task in the detail pane when its row is clicked", () => {
    renderWorkspace();
    expect(screen.getByText(defaultTasksLabels.selectTask)).toBeTruthy();

    fireEvent.click(screen.getByText("Buy milk"));

    const title = screen.getByLabelText(defaultTasksLabels.addTaskName) as HTMLTextAreaElement;
    expect(title.value).toBe("Buy milk");
    expect(screen.queryByText(defaultTasksLabels.selectTask)).toBeNull();
  });

  it("filters the rows by the search field", async () => {
    renderWorkspace();
    expect(screen.getByText("Review API spec")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(defaultTasksLabels.searchPlaceholder), {
      target: { value: "milk" },
    });

    // The search field waits for a typing pause.
    await waitFor(() => expect(screen.queryByText("Review API spec")).toBeNull());
    expect(screen.getByText("Buy milk")).toBeTruthy();
  });
});

describe("filterTasksBySearch", () => {
  const tasks = bootstrap.data.tasks;

  it("matches title and notes, ignoring case and outer spaces", () => {
    expect(filterTasksBySearch(tasks, "  BUY milk ").map((task) => task.id)).toEqual([
      "task-buy-milk",
    ]);
    const withNotes = tasks.filter((task) => task.description?.trim());
    const word = withNotes[0]!.description!.trim().split(/\s+/)[0]!;
    expect(filterTasksBySearch(tasks, word).map((task) => task.id)).toContain(withNotes[0]!.id);
  });

  it("returns every task for an empty query", () => {
    expect(filterTasksBySearch(tasks, "   ")).toBe(tasks);
  });
});
