// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import type { ProjectOperations } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { createProjectsStore } from "@/lib/projects/projects-store";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import { TooltipProvider } from "@/ui/tooltip";

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
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
});

async function renderPane(operations: ProjectOperations = createMockProjectOperations()) {
  const store = createProjectsStore(operations);
  render(
    <TooltipProvider delayDuration={0}>
      <AutosaveStatusProvider>
        <AutosaveStatusTag />
        <ProjectsManagePane store={store} />
      </AutosaveStatusProvider>
    </TooltipProvider>,
  );
  await screen.findByLabelText("Name of Website relaunch");
  return { store, operations };
}

describe("ProjectsManagePane", () => {
  it("lists Projects per Team; only the admin Team's rows are editable", async () => {
    await renderPane();
    expect(screen.getByRole("heading", { name: "Design" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sales" })).toBeTruthy();
    expect(screen.getByLabelText("Name of Design Project")).toBeTruthy();
    // The Sales Project is read-only: text, no field, no actions.
    expect(screen.queryByLabelText("Name of Sales Project")).toBeNull();
    expect(screen.getByText("Sales Project")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
  });

  it("shows no archive for the default Project", async () => {
    await renderPane();
    const row = screen.getByLabelText("Name of Design Project").closest("li")!;
    expect(row.textContent).toContain("Whole Team");
    expect(within(row).queryByRole("button", { name: /Archive|Restore|Delete/ })).toBeNull();
  });

  it("autosaves the name after a pause and the color at once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { store } = await renderPane();
    fireEvent.change(screen.getByLabelText("Name of Website relaunch"), {
      target: { value: "Relaunch 2" },
    });
    expect(store.getSnapshot().projects.some((p) => p.name === "Relaunch 2")).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
    });
    await waitFor(() =>
      expect(store.getSnapshot().projects.some((p) => p.name === "Relaunch 2")).toBe(true),
    );
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("saves the name when the field is left, and drops an empty name", async () => {
    const { store } = await renderPane();
    const field = screen.getByLabelText("Name of Website relaunch") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Shop" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(store.getSnapshot().projects.some((p) => p.name === "Shop")).toBe(true),
    );
    const shop = screen.getByLabelText("Name of Shop") as HTMLInputElement;
    fireEvent.change(shop, { target: { value: "  " } });
    fireEvent.blur(shop);
    await waitFor(() => expect(shop.value).toBe("Shop"));
  });

  it("archives at once into the Archived group, then restores", async () => {
    const { store } = await renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByRole("heading", { name: "Archived" });
    expect(store.getSnapshot().archived.map((p) => p.name)).toEqual(["Website relaunch"]);
    expect(toast.showSuccess).toHaveBeenCalledWith("Project “Website relaunch” archived");
    // Archived rows are text, with Restore and Delete permanently.
    expect(screen.queryByLabelText("Name of Website relaunch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await screen.findByLabelText("Name of Website relaunch");
    expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull();
  });

  it("purges only after the Project name is typed", async () => {
    const { store } = await renderPane();
    await act(async () => {
      await store.archive(
        store.getSnapshot().projects.find((p) => p.name === "Website relaunch")!.id,
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete permanently" }));
    const confirm = (await screen.findAllByRole("button", { name: "Delete permanently" })).pop()!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type “Website relaunch”/), {
      target: { value: "Website" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type “Website relaunch”/), {
      target: { value: "Website relaunch" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(store.getSnapshot().archived).toEqual([]));
    expect(toast.showSuccess).toHaveBeenCalledWith("Project “Website relaunch” deleted");
    expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull();
  });

  it("shows the server's 409 for an archive and reads the lists again", async () => {
    const operations = createMockProjectOperations();
    const archive = vi.fn(async () => {
      throw new WgwRequestError("The default Project cannot be archived.", 409);
    });
    const { store } = await renderPane({ ...operations, archive });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not archive the Project", {
        description: "The default Project cannot be archived.",
      }),
    );
    expect(store.getSnapshot().projects.some((p) => p.name === "Website relaunch")).toBe(true);
  });

  it("shows the 409 of a purge and keeps the dialog open", async () => {
    const operations = createMockProjectOperations();
    const purge = vi.fn(async () => {
      throw new WgwRequestError("Archive the Project before you purge it.", 409);
    });
    const { store } = await renderPane({ ...operations, purge });
    await act(async () => {
      await store.archive(
        store.getSnapshot().projects.find((p) => p.name === "Website relaunch")!.id,
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete permanently" }));
    fireEvent.change(await screen.findByLabelText(/Type “Website relaunch”/), {
      target: { value: "Website relaunch" },
    });
    const confirm = screen.getAllByRole("button", { name: "Delete permanently" }).pop()!;
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not delete the Project", {
        description: "Archive the Project before you purge it.",
      }),
    );
    expect(screen.getByLabelText(/Type “Website relaunch”/)).toBeTruthy();
  });

  it("restores the field and shows the 409 when a rename is refused", async () => {
    const operations = createMockProjectOperations();
    const patch = vi.fn(async () => {
      throw new WgwRequestError("An archived Project cannot be changed. Unarchive it first.", 409);
    });
    await renderPane({ ...operations, patch });
    const field = screen.getByLabelText("Name of Website relaunch") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(toast.showError).toHaveBeenCalledWith("Could not save the Project", {
        description: "An archived Project cannot be changed. Unarchive it first.",
      }),
    );
    await waitFor(() => expect(field.value).toBe("Website relaunch"));
    expect(screen.getByRole("status").textContent).toContain("Unsaved");
  });

  it("shows a read-only list to a member without a team-admin role", async () => {
    const teams = [{ ...MOCK_PROJECT_TEAMS[1]! }];
    const store = createProjectsStore(createMockProjectOperations(teams));
    render(
      <TooltipProvider delayDuration={0}>
        <ProjectsManagePane store={store} />
      </TooltipProvider>,
    );
    await screen.findByText("Sales Project");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});
