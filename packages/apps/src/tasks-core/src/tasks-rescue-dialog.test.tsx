import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog, TasksRescueEntry } from "@/tasks-core/src/tasks-rescue-dialog";

const bootstrap = createTasksAppBootstrap();

function parked(index: number, kind: ParkedTask["kind"]): ParkedTask {
  const item = bootstrap.data.tasks[index]!;
  return {
    id: `tasks:${item.id}`,
    domain: "tasks",
    entityId: item.id,
    kind,
    reason: "gone",
    containerId: "gone-list",
    containerName: "Groceries",
    title: item.title ?? "",
    item,
    parkedAt: 1,
  };
}

const writes = [parked(0, "create"), parked(1, "edit")];

function renderDialog() {
  const onMove = vi.fn();
  const onDiscard = vi.fn();
  const onLater = vi.fn();
  render(
    <TasksRescueDialog
      open
      writes={writes}
      lists={bootstrap.data.taskLists}
      labels={L}
      onMove={onMove}
      onDiscard={onDiscard}
      onLater={onLater}
    />,
  );
  return { onMove, onDiscard, onLater };
}

describe("TasksRescueDialog", () => {
  afterEach(cleanup);

  it("lists every task and moves them all to a new list named after the old one", () => {
    const { onMove } = renderDialog();

    expect(screen.getByRole("heading", { name: L.rescueTitle(2) })).toBeTruthy();
    expect(screen.getByText(writes[0]!.title)).toBeTruthy();
    expect(screen.getByText(new RegExp(L.rescueAsNewTask))).toBeTruthy();
    expect(screen.getByRole("textbox", { name: L.rescueNewListLabel })).toHaveProperty(
      "value",
      L.rescueNewListName("Groceries"),
    );

    fireEvent.click(screen.getByRole("button", { name: L.rescueMove(2) }));

    expect(onMove).toHaveBeenCalledWith(
      writes.map((write) => write.id),
      { newListName: L.rescueNewListName("Groceries") },
    );
  });

  it("moves only the ticked tasks to an existing list", () => {
    const { onMove } = renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(writes[1]!.title) }));
    const list = bootstrap.data.taskLists[0]!;
    const trigger = screen.getByRole("button", {
      name: `${L.rescueDestinationLabel}: ${L.rescueNewList}`,
    });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: list.name }));

    // Picking a list hides the name field for a new one.
    expect(screen.queryByRole("textbox", { name: L.rescueNewListLabel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: L.rescueMove(1) }));

    expect(onMove).toHaveBeenCalledWith([writes[0]!.id], { listId: list.id });
  });

  it("discards the ticked tasks, and Later keeps them", () => {
    const { onDiscard, onLater } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: L.rescueDiscard(2) }));
    fireEvent.click(screen.getByRole("button", { name: L.rescueLater }));

    expect(onDiscard).toHaveBeenCalledWith(writes.map((write) => write.id));
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("offers the way back only while tasks wait", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<TasksRescueEntry count={0} labels={L} onOpen={onOpen} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<TasksRescueEntry count={2} labels={L} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: L.rescueEntry(2) }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
