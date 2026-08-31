import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskProjectDialog,
  taskProjectDialogLabelsFrom,
} from "@/tasks-core/src/task-project-dialog";
import { TaskListDot } from "@/tasks-core/src/tasks-list-dot";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { DEFAULT_TASK_LIST_COLOR, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";

const dialogLabels = taskProjectDialogLabelsFrom(defaultTasksLabels);

const groups = [
  { slug: "team", displayName: "Team" },
  { slug: "studio", displayName: "Studio Crew" },
];

function openColorPicker() {
  fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.projectColorLabel }));
}

describe("TaskProjectDialog", () => {
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

  it("submits trimmed create payload with selected color and personal scope", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={onClose}
        onConfirm={onConfirm}
        labels={dialogLabels}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.projectNameLabel), {
      target: { value: "  Launch plan  " },
    });
    openColorPicker();
    fireEvent.click(screen.getByRole("radio", { name: "#ec4899" }));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.createProjectButton }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Launch plan",
      color: "#ec4899",
      groupSlug: null,
    });
  });

  it("submits group scope when a group is selected", () => {
    const onConfirm = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        labels={dialogLabels}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.projectNameLabel), {
      target: { value: "Roadmap" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: defaultTasksLabels.projectScopeLabel }));
    fireEvent.click(
      screen.getByRole("option", { name: defaultTasksLabels.projectScopeGroup("Team") }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.createProjectButton }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Roadmap",
      color: DEFAULT_TASK_LIST_COLOR,
      groupSlug: "team",
    });
  });

  it("disables create until a name is entered", () => {
    render(
      <TaskProjectDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: defaultTasksLabels.createProjectButton,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("lets the owner change directory on edit after confirm", () => {
    const onConfirm = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "work",
          name: "Work",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
          canChangeOwner: true,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        labels={dialogLabels}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultTasksLabels.projectScopeLabel,
    });
    expect(ownerSelect).toHaveProperty("disabled", false);
    fireEvent.click(ownerSelect);
    fireEvent.click(
      screen.getByRole("option", { name: defaultTasksLabels.projectScopeGroup("Team") }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveProjectButton }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: defaultTasksLabels.changeListOwnerConfirmTitle }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: defaultTasksLabels.changeListOwnerConfirm }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Work",
      color: "#6366f1",
      groupSlug: "team",
    });
  });

  it("shows read-only owner on edit and submits name/color changes", () => {
    const onConfirm = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "work",
          name: "Work",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        labels={dialogLabels}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultTasksLabels.projectScopeLabel,
    });
    expect(ownerSelect).toHaveProperty("disabled", true);
    expect(ownerSelect.textContent).toContain("Only Me");

    fireEvent.change(screen.getByLabelText(defaultTasksLabels.projectNameLabel), {
      target: { value: "Client work" },
    });
    openColorPicker();
    fireEvent.click(screen.getByRole("radio", { name: "#22c55e" }));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveProjectButton }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Client work",
      color: "#22c55e",
    });
  });

  it("shows project name label aligned with owner field", () => {
    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "work",
          name: "Work",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    expect(
      screen.getByText(defaultTasksLabels.projectNameLabel, { selector: "label" }),
    ).toBeTruthy();
    expect(
      screen.getByText(defaultTasksLabels.projectScopeLabel, { selector: "label" }),
    ).toBeTruthy();
    const nameInput = screen.getByLabelText(
      defaultTasksLabels.projectNameLabel,
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Work");
  });

  it("shows hashed color when API color is null", () => {
    const listId = "roadmap";

    const { container: reference } = render(<TaskListDot list={{ id: listId, color: null }} />);
    const referenceColor = (reference.querySelector(".tasks-list-dot") as HTMLElement).style
      .backgroundColor;

    cleanup();

    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId,
          name: "Roadmap",
          color: null,
          scope: "personal",
          groupSlug: null,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    const dot = document.querySelector(".color-swatch-trigger__dot") as HTMLElement;
    expect(dot.style.backgroundColor).toBe(referenceColor);
    expect(referenceColor).not.toBe("");
    expect(taskListDotColor({ id: listId, color: null })).not.toBe(DEFAULT_TASK_LIST_COLOR);
  });

  it("does not show owner helper text on create", () => {
    render(
      <TaskProjectDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    expect(screen.queryByText("Only you can manage this project.")).toBeNull();
    const ownerSelect = screen.getByRole("combobox", {
      name: defaultTasksLabels.projectScopeLabel,
    });
    expect(ownerSelect.textContent).toContain("Only Me");
  });

  it("calls onClose when cancel is clicked", () => {
    const onClose = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={onClose}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.cancel }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hosts list share copy when mayShare is set", () => {
    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "inbox",
          name: "Inbox",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
          mayShare: true,
          shareWith: null,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
        share={{
          online: true,
          onSearchPrincipals: async () => [],
          onPatchShareWith: async () => undefined,
        }}
      />,
    );

    expect(screen.getByText(defaultTasksLabels.shareListSectionTitle)).toBeTruthy();
    expect(screen.getByText(defaultTasksLabels.shareListSectionHint)).toBeTruthy();
    expect(screen.queryByText("calendar")).toBeNull();
  });

  it("lets a sharee rename and offers Remove list", () => {
    const onRemoveShared = vi.fn();
    const onConfirm = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "shared-inbox",
          name: "Inbox",
          color: "#3b82f6",
          scope: "personal",
          groupSlug: null,
          isSharee: true,
          mayShare: false,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        onRemoveShared={onRemoveShared}
        labels={dialogLabels}
      />,
    );

    expect(screen.queryByText(defaultTasksLabels.shareListSectionTitle)).toBeNull();
    fireEvent.change(screen.getByLabelText(defaultTasksLabels.projectNameLabel), {
      target: { value: "Alice inbox" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.saveProjectButton }));
    expect(onConfirm).toHaveBeenCalledWith({
      name: "Alice inbox",
      color: "#3b82f6",
    });

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.removeSharedList }));
    fireEvent.click(
      screen.getAllByRole("button", { name: defaultTasksLabels.removeSharedList }).at(-1)!,
    );
    expect(onRemoveShared).toHaveBeenCalledTimes(1);
  });

  it("confirms owner delete when mayDelete and onDelete are set", () => {
    const onDelete = vi.fn();

    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "work",
          name: "Work",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
          mayDelete: true,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={onDelete}
        labels={dialogLabels}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.deleteList }));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("hides owner delete without mayDelete or onDelete", () => {
    render(
      <TaskProjectDialog
        dialog={{
          mode: "edit",
          listId: "work",
          name: "Work",
          color: "#6366f1",
          scope: "personal",
          groupSlug: null,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        labels={dialogLabels}
      />,
    );

    expect(screen.queryByRole("button", { name: defaultTasksLabels.deleteList })).toBeNull();
  });
});
