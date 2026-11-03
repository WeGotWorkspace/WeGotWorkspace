import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog, TasksRescueEntry } from "@/tasks-core/src/tasks-rescue-dialog";

const bootstrap = createTasksAppBootstrap();
const template = bootstrap.data.tasks[0]!;
let order = 0;

function parked(
  title: string,
  containerName: string,
  reason: ParkedTask["reason"] = "gone",
  kind: ParkedTask["kind"] = "create",
): ParkedTask {
  order += 1;
  const entityId = `task-${order}`;
  return {
    id: `tasks:${entityId}`,
    domain: "tasks",
    entityId,
    kind,
    reason,
    containerId: `list-${containerName}`,
    containerName,
    title,
    item: { ...template, id: entityId, title },
    parkedAt: order,
  };
}

function renderDialog(writes: ParkedTask[]) {
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

function pickList(name: string) {
  const trigger = screen.getByRole("button", {
    name: new RegExp(`^${L.rescueDestinationLabel}:`),
  });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

describe("TasksRescueDialog", () => {
  afterEach(cleanup);

  it("asks once for all tasks of a deleted list and moves them to a list of the same name", () => {
    const writes = [parked("Call the dentist", "Groceries"), parked("Buy milk", "Groceries")];
    const { onMove } = renderDialog(writes);

    expect(screen.getByRole("heading", { name: L.rescueListTitle(2, "Groceries") })).toBeTruthy();
    expect(screen.getByText(L.rescueReason("Groceries", "gone"))).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("textbox", { name: L.rescueNewListLabel })).toHaveProperty(
      "value",
      "Groceries",
    );

    fireEvent.click(screen.getByRole("button", { name: L.rescueMove(2) }));

    expect(onMove).toHaveBeenCalledWith(
      writes.map((write) => write.id),
      { newContainerName: "Groceries" },
    );
  });

  it("suggests a copy name for a view-only list and says edits become new tasks", () => {
    renderDialog([parked("Renew passport", "Team errands", "readOnly", "edit")]);

    expect(screen.getByText(new RegExp(L.rescueEditsAsNew))).toBeTruthy();
    expect(screen.queryByText("Renew passport")).toBeNull();
    expect(screen.getByRole("textbox", { name: L.rescueNewListLabel })).toHaveProperty(
      "value",
      "Team errands (copy)",
    );
  });

  it("takes the reason from the list's newest refusal", () => {
    renderDialog([
      parked("Renew passport", "Team errands", "readOnly"),
      parked("Book train tickets", "Team errands", "gone"),
    ]);

    expect(screen.getByText(L.rescueReason("Team errands", "gone"))).toBeTruthy();
    expect(screen.getByRole("textbox", { name: L.rescueNewListLabel })).toHaveProperty(
      "value",
      "Team errands",
    );
  });

  it("moves to an existing list, which hides the new-list name", () => {
    const writes = [parked("Call the dentist", "Groceries")];
    const list = bootstrap.data.taskLists[0]!;
    const { onMove } = renderDialog(writes);

    pickList(list.name);

    expect(screen.queryByRole("textbox", { name: L.rescueNewListLabel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: L.rescueMove(1) }));
    expect(onMove).toHaveBeenCalledWith([writes[0]!.id], { containerId: list.id });
  });

  it("counts a long list in the title without naming its tasks", () => {
    const titles = Array.from({ length: 25 }, (_, index) => `Errand ${index + 1}`);
    renderDialog(titles.map((title) => parked(title, "Household")));

    expect(screen.getByRole("heading", { name: L.rescueListTitle(25, "Household") })).toBeTruthy();
    expect(screen.queryByText("Errand 1")).toBeNull();
    expect(screen.getByRole("button", { name: L.rescueMove(25) })).toBeTruthy();
  });

  it("takes several lists one at a time; Later skips to the next, then closes", () => {
    const groceries = [parked("Call the dentist", "Groceries")];
    const errands = [parked("Renew passport", "Team errands", "readOnly")];
    const { onDiscard, onLater } = renderDialog([...groceries, ...errands]);

    expect(screen.getByText(L.rescueStep(1, 2))).toBeTruthy();
    expect(screen.getByRole("heading", { name: L.rescueListTitle(1, "Groceries") })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: L.rescueLater }));
    expect(onLater).not.toHaveBeenCalled();
    expect(screen.getByText(L.rescueStep(2, 2))).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: L.rescueListTitle(1, "Team errands") }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: L.rescueDiscard(1) }));
    expect(onDiscard).toHaveBeenCalledWith([errands[0]!.id]);

    fireEvent.click(screen.getByRole("button", { name: L.rescueLater }));
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("lets go once only put-off lists are left, and asks about them on the next open", () => {
    const groceries = [parked("Call the dentist", "Groceries")];
    const errands = [parked("Renew passport", "Team errands", "readOnly")];
    const onLater = vi.fn();
    const dialog = (open: boolean, writes: ParkedTask[]) => (
      <TasksRescueDialog
        open={open}
        writes={writes}
        lists={bootstrap.data.taskLists}
        labels={L}
        onMove={vi.fn()}
        onDiscard={vi.fn()}
        onLater={onLater}
      />
    );
    const { rerender } = render(dialog(true, [...groceries, ...errands]));

    fireEvent.click(screen.getByRole("button", { name: L.rescueLater }));
    expect(onLater).not.toHaveBeenCalled();

    // Moving or discarding "Team errands" leaves only the put-off list.
    rerender(dialog(true, groceries));
    expect(onLater).toHaveBeenCalledOnce();

    rerender(dialog(false, groceries));
    rerender(dialog(true, groceries));
    expect(screen.getByRole("heading", { name: L.rescueListTitle(1, "Groceries") })).toBeTruthy();
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("offers the way back only while lists wait", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<TasksRescueEntry lists={0} labels={L} onOpen={onOpen} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<TasksRescueEntry lists={2} labels={L} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: L.rescueEntry(2) }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
