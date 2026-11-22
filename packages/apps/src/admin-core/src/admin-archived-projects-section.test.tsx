import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { AdminArchivedProjectsSection } from "@/admin-core/src/admin-archived-projects-section";
import {
  createMockAdminProjectOperations,
  type AdminProjectOperations,
} from "@/admin-core/src/admin-projects-operations";

const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock("@/hooks/use-app-toast", () => ({ useAppToast: () => toast }));

beforeEach(() => {
  toast.showSuccess.mockClear();
  toast.showError.mockClear();
});
afterEach(cleanup);

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

async function renderSection(operations: AdminProjectOperations) {
  render(<AdminArchivedProjectsSection operations={operations} />);
  await screen.findByText("Website relaunch");
}

async function confirmDelete(name: string) {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: /Delete permanently/ }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
}

describe("AdminArchivedProjectsSection", () => {
  it("lists the archived Projects with their Team and an Archived tag", async () => {
    await renderSection(createMockAdminProjectOperations());
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // By Team, then name.
    expect(rows.map((row) => row.querySelector(".admin-project-row__name")?.textContent)).toEqual([
      "Audit 2025",
      "Brand refresh",
      "Website relaunch",
    ]);
    expect(within(rowOf("Audit 2025")).getByText("Finance", { exact: false })).toBeTruthy();
    expect(within(rowOf("Website relaunch")).getByText("Archived")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    render(<AdminArchivedProjectsSection operations={createMockAdminProjectOperations([])} />);
    expect(await screen.findByText("No archived Projects")).toBeTruthy();
  });

  it("asks for the typed name before deleting", async () => {
    const operations = createMockAdminProjectOperations();
    const purge = vi.spyOn(operations, "purge");
    await renderSection(operations);
    fireEvent.click(
      within(rowOf("Website relaunch")).getByRole("button", { name: /Delete permanently/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Website" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(purge).not.toHaveBeenCalled();
  });

  it("removes the row and toasts success after a delete", async () => {
    const operations = createMockAdminProjectOperations();
    const purge = vi.spyOn(operations, "purge");
    await renderSection(operations);
    await confirmDelete("Website relaunch");
    await waitFor(() => expect(screen.queryByText("Website relaunch")).toBeNull());
    expect(purge).toHaveBeenCalledWith("p-site");
    expect(toast.showSuccess).toHaveBeenCalledWith("Project “Website relaunch” deleted");
    expect(screen.getByText("Brand refresh")).toBeTruthy();
  });

  it.each([409, 403])("shows the server message and reloads on a %i", async (status) => {
    const operations = createMockAdminProjectOperations();
    const list = vi.spyOn(operations, "listArchived");
    vi.spyOn(operations, "purge").mockRejectedValue(
      new WgwRequestError("Only an archived Project can be deleted", status),
    );
    await renderSection(operations);
    expect(list).toHaveBeenCalledTimes(1);
    await confirmDelete("Website relaunch");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(toast.showError).toHaveBeenCalledWith("Could not delete the Project", {
      description: "Only an archived Project can be deleted",
    });
    expect(screen.getByText("Website relaunch")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
