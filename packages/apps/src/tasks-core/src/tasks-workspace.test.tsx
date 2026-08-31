import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
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

describe("TasksWorkspace show completed toggle", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
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

  it("reveals completed rows when the icon-only show-completed toggle is pressed", () => {
    renderWorkspace();

    const toggle = screen.getByRole("button", { name: defaultTasksLabels.showCompletedTasks });
    expect(toggle.textContent).not.toContain(defaultTasksLabels.showCompletedTasks);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Ship v0.9")).toBeNull();

    fireEvent.click(toggle);

    const hide = screen.getByRole("button", { name: defaultTasksLabels.hideCompletedTasks });
    expect(hide).toBeTruthy();
    expect(hide.textContent).not.toContain(defaultTasksLabels.hideCompletedTasks);
    expect(screen.getByText("Ship v0.9")).toBeTruthy();
  });
});
