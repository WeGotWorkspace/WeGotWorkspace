import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksNewMenu } from "@/tasks-core/src/tasks-new-menu";
import { TooltipProvider } from "@/ui/tooltip";

const L = defaultTasksLabels;

function openMenu() {
  const trigger = screen.getByRole("button", { name: L.newTaskMenu });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("TasksNewMenu import item", () => {
  beforeEach(() => {
    cleanup();
  });

  it("opens the file picker", () => {
    const onImportTasks = vi.fn();
    render(
      <TooltipProvider>
        <TasksNewMenu labels={L} onCreateTask={vi.fn()} onImportTasks={onImportTasks} />
      </TooltipProvider>,
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: L.importTasks }));

    expect(onImportTasks).toHaveBeenCalledOnce();
  });

  it("is disabled with a reason while offline", () => {
    const onImportTasks = vi.fn();
    render(
      <TooltipProvider>
        <TasksNewMenu
          labels={L}
          onCreateTask={vi.fn()}
          onImportTasks={onImportTasks}
          importOffline
        />
      </TooltipProvider>,
    );

    openMenu();
    const item = screen.getByRole("menuitem", { name: new RegExp(L.importTasks) });
    expect(item.getAttribute("aria-disabled") ?? item.getAttribute("data-disabled")).not.toBeNull();
    expect(item.textContent).toContain(L.importTasksOffline);
    fireEvent.click(item);
    expect(onImportTasks).not.toHaveBeenCalled();
  });

  it("hides the item when import is not available", () => {
    render(
      <TooltipProvider>
        <TasksNewMenu labels={L} onCreateTask={vi.fn()} onCreateList={vi.fn()} />
      </TooltipProvider>,
    );

    openMenu();
    expect(screen.queryByRole("menuitem", { name: L.importTasks })).toBeNull();
  });
});
