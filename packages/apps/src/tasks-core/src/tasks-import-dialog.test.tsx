import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksImportDialog } from "@/tasks-core/src/tasks-import-dialog";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { DEFAULT_TASK_LIST_COLOR } from "@/tasks-core/src/tasks-task-utils";
import type { Task } from "@/tasks-core/src/tasks-types";
import { TooltipProvider } from "@/ui/tooltip";

const bootstrap = createTasksAppBootstrap();
const L = defaultTasksLabels;
const file = new File(["BEGIN:VCALENDAR"], "groceries.ics", { type: "text/calendar" });

function renderDialog(ui: ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

function destinationTrigger(name: string) {
  return screen.getByRole("button", { name: `${L.importDestinationLegend}: ${name}` });
}

function openDestination(name: string) {
  const trigger = destinationTrigger(name);
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("TasksImportDialog", () => {
  beforeEach(() => {
    cleanup();
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

  it("imports into the list in view", () => {
    const onImport = vi.fn();
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={bootstrap.data.taskLists}
        preferredTaskListId="work"
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(file, { mode: "existing", collectionId: "work" });
  });

  it("preselects a writable shared list in view", () => {
    const onImport = vi.fn();
    const sharedWritable = {
      ...bootstrap.data.taskLists[2]!,
      id: "shared-team",
      name: "Shared team",
      isSharee: true,
      myRights: { ...bootstrap.data.taskLists[2]!.myRights!, mayWriteAll: true },
    };
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={[...bootstrap.data.taskLists, sharedWritable]}
        preferredTaskListId="shared-team"
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(file, { mode: "existing", collectionId: "shared-team" });
  });

  it("offers writable lists only, then New list", () => {
    const viewOnly = {
      ...bootstrap.data.taskLists[2]!,
      id: "view-only",
      name: "View only list",
      isSharee: true,
      myRights: { ...bootstrap.data.taskLists[2]!.myRights!, mayWriteAll: false },
    };
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={[...bootstrap.data.taskLists, viewOnly]}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    openDestination("Inbox");
    const menu = screen.getByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(names).toEqual(["Inbox", "Personal", "Work", L.importNewList]);
  });

  it("creates a new list named after the file", () => {
    const onImport = vi.fn();
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={bootstrap.data.taskLists}
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    openDestination("Inbox");
    fireEvent.click(screen.getByRole("menuitem", { name: L.importNewList }));
    expect(screen.getByLabelText(L.projectNameLabel)).toHaveProperty("value", "groceries");
    fireEvent.change(screen.getByLabelText(L.projectNameLabel), { target: { value: "Shopping" } });
    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(file, {
      mode: "create",
      name: "Shopping",
      color: DEFAULT_TASK_LIST_COLOR,
    });
  });

  it("goes straight to New list when no list is writable", () => {
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={bootstrap.data.taskLists.map((list) => ({
          ...list,
          myRights: { ...list.myRights!, mayWriteAll: false },
        }))}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(destinationTrigger(L.importNewList)).toBeTruthy();
    expect(screen.getByLabelText(L.projectNameLabel)).toBeTruthy();
  });

  it("shows the result: count, failed tasks with reasons and skipped events", () => {
    const onClose = vi.fn();
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={bootstrap.data.taskLists}
        result={{
          list: [{ id: "t1" } as Task, { id: "t2" } as Task],
          errors: [
            { index: 2, message: "x", code: "already_exists", title: "Buy milk" },
            { index: 3, message: "Unparseable recurrence rule." },
          ],
          skipped: { events: 4 },
        }}
        onClose={onClose}
        onImport={vi.fn()}
      />,
    );

    const status = screen.getByRole("status");
    expect(within(status).getByText("Imported 2 tasks")).toBeTruthy();
    expect(within(status).getByText("2 tasks could not be imported:")).toBeTruthy();
    expect(status.textContent).toContain(`Buy milk — ${L.importErrorAlreadyExists}`);
    expect(status.textContent).toContain(`${L.importUntitledTask} — Unparseable recurrence rule.`);
    expect(
      within(status).getByText("4 events were skipped. Import them in Calendar."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: L.importSubmit })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: L.importDone }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing was imported", () => {
    renderDialog(
      <TasksImportDialog
        open
        file={file}
        labels={L}
        taskLists={bootstrap.data.taskLists}
        result={{
          list: [],
          errors: [{ index: 0, message: "x", code: "already_exists", title: "Buy milk" }],
          skipped: { events: 0 },
        }}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByText(L.importNoneImported)).toBeTruthy();
    expect(screen.queryByText(/events were skipped/)).toBeNull();
  });
});
