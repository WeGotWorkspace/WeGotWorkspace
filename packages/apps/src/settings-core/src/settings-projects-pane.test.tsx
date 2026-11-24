// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectOperations } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { createProjectsStore } from "@/lib/projects/projects-store";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import { TooltipProvider } from "@/ui/tooltip";

const TEAM_GROUPS: SettingsGroup[] = MOCK_PROJECT_TEAMS.map((team, index) => ({
  id: `principals/groups/${team.slug}`,
  displayName: team.displayName,
  memberCount: index + 3,
  isTeamAdmin: team.isTeamAdmin,
}));

const toast = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ ...toast, show: vi.fn(), dismiss: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  toast.showError.mockClear();
  toast.showSuccess.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function renderPane(operations: ProjectOperations = createMockProjectOperations()) {
  const store = createProjectsStore(operations);
  render(
    <TooltipProvider delayDuration={0}>
      <AutosaveStatusProvider>
        <AutosaveStatusTag />
        <ProjectsManagePane store={store} groups={TEAM_GROUPS} />
      </AutosaveStatusProvider>
    </TooltipProvider>,
  );
  await screen.findByText("Website relaunch");
  return { store, operations };
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

describe("ProjectsManagePane", () => {
  it("lists the Teams with member count and role, and the Projects of each", async () => {
    await renderPane();
    expect(screen.getByRole("heading", { name: "Design" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sales" })).toBeTruthy();
    expect(screen.getByTitle("3 members")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
    // Only the admin Team has actions: Edit on both rows, Archive on the extra one, New Project.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "New Project" })).toHaveLength(1);
    expect(within(rowOf("Sales Project")).queryByRole("button")).toBeNull();
  });

  it("has no archive for the default Project", async () => {
    await renderPane();
    const row = rowOf("Design Project");
    expect(within(row).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("stores a rename and color only after Save", async () => {
    const { store } = await renderPane();
    fireEvent.click(within(rowOf("Website relaunch")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Project" });
    const save = within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Relaunch 2" } });
    expect(store.getSnapshot().projects.some((p) => p.name === "Relaunch 2")).toBe(false);
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() =>
      expect(store.getSnapshot().projects.some((p) => p.name === "Relaunch 2")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Project" })).toBeNull());
  });

  it("stores nothing when the edit dialog is cancelled", async () => {
    const { store } = await renderPane();
    fireEvent.click(within(rowOf("Website relaunch")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Project" })).toBeNull());
    expect(store.getSnapshot().projects.some((p) => p.name === "Nope")).toBe(false);
  });

  it("keeps the dialog open and shows the server's answer when a rename is refused", async () => {
    const operations = createMockProjectOperations();
    const patch = vi.fn(async () => {
      throw new WgwRequestError("An archived Project cannot be changed. Unarchive it first.", 409);
    });
    await renderPane({ ...operations, patch });
    fireEvent.click(within(rowOf("Website relaunch")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Late" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not save the Project", {
        description: "An archived Project cannot be changed. Unarchive it first.",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Edit Project" })).toBeTruthy();
  });

  it("asks to confirm an archive, then keeps the Project in its Team with a tag and Restore", async () => {
    const { store } = await renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(store.getSnapshot().archived).toEqual([]);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    });
    await waitFor(() => expect(store.getSnapshot().archived).toHaveLength(1));
    expect(toast.showSuccess).toHaveBeenCalledWith("Project “Website relaunch” archived");
    const row = rowOf("Website relaunch");
    expect(within(row).getByText("Archived")).toBeTruthy();
    // A team admin deletes an archived Project for good, after typing its name.
    expect(within(row).getByRole("button", { name: /Delete permanently/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Restore" }));
    });
    await waitFor(() => expect(store.getSnapshot().archived).toEqual([]));
    expect(within(rowOf("Website relaunch")).queryByText("Archived")).toBeNull();
  });

  it("deletes an archived Project only after its name is typed", async () => {
    const { store } = await renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await act(async () => {
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Archive" }),
      );
    });
    await waitFor(() => expect(store.getSnapshot().archived).toHaveLength(1));
    fireEvent.click(
      within(rowOf("Website relaunch")).getByRole("button", { name: /Delete permanently/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Website relaunch" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(store.getSnapshot().archived).toEqual([]));
    expect(toast.showSuccess).toHaveBeenCalledWith("Project “Website relaunch” deleted");
    expect(screen.queryByText("Website relaunch")).toBeNull();
  });

  it("shows the server's answer when a delete is refused", async () => {
    const operations = createMockProjectOperations();
    const purge = vi.fn(async () => {
      throw new WgwRequestError("Only a team admin can change a Project.", 403);
    });
    const { store } = await renderPane({ ...operations, purge });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await act(async () => {
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Archive" }),
      );
    });
    await waitFor(() => expect(store.getSnapshot().archived).toHaveLength(1));
    fireEvent.click(
      within(rowOf("Website relaunch")).getByRole("button", { name: /Delete permanently/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Website relaunch" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    });
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not delete the Project", {
        description: "Only a team admin can change a Project.",
      }),
    );
  });

  it("does not archive when the confirmation is cancelled", async () => {
    const { store } = await renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.getSnapshot().archived).toEqual([]);
  });

  it("shows the server's 409 for an archive and reads the lists again", async () => {
    const operations = createMockProjectOperations();
    const archive = vi.fn(async () => {
      throw new WgwRequestError("The default Project cannot be archived.", 409);
    });
    const { store } = await renderPane({ ...operations, archive });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    });
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not archive the Project", {
        description: "The default Project cannot be archived.",
      }),
    );
    expect(store.getSnapshot().projects.some((p) => p.name === "Website relaunch")).toBe(true);
  });
});
