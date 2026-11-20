// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import { readProjectFilter } from "@/lib/projects/project-filter";
import { createProjectsStore } from "@/lib/projects/projects-store";
import { CreateProjectDialog } from "@/projects-ui/src/create-project-dialog";
import { ProjectFilterSelect } from "@/projects-ui/src/project-filter-select";
import { TooltipProvider } from "@/ui/tooltip";

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function loadedStore(teams = MOCK_PROJECT_TEAMS) {
  const store = createProjectsStore(createMockProjectOperations(teams));
  await store.load();
  return store;
}

function renderSelect(store: Awaited<ReturnType<typeof loadedStore>>) {
  return render(
    <TooltipProvider delayDuration={0}>
      <ProjectFilterSelect store={store} />
    </TooltipProvider>,
  );
}

describe("ProjectFilterSelect", () => {
  it("renders nothing before the Projects load", () => {
    const store = createProjectsStore(createMockProjectOperations());
    const { container } = renderSelect(store);
    expect(container.textContent).toBe("");
  });

  it("shows All Projects, then the Projects per Team, and Create Project for a team admin", async () => {
    renderSelect(await loadedStore());
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger.textContent).toContain("All Projects");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual([
      "All Projects",
      "Design Project",
      "Website relaunch",
      "Sales Project",
      "Create Project",
    ]);
  });

  it("offers no Create Project without a team-admin role", async () => {
    renderSelect(await loadedStore([{ slug: "sales", displayName: "Sales", isTeamAdmin: false }]));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["All Projects", "Sales Project", "Website relaunch"]);
  });

  it("stores the chosen Project", async () => {
    const store = await loadedStore();
    renderSelect(store);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    const option = await screen.findByRole("option", { name: "Website relaunch" });
    fireEvent.keyDown(option, { key: "Enter" });
    const chosen = store.getSnapshot().projects.find((p) => p.name === "Website relaunch");
    expect(readProjectFilter()).toBe(`p:${chosen?.id}`);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Project" }).textContent).toContain(
        "Website relaunch",
      ),
    );
  });
});

describe("CreateProjectDialog", () => {
  it("creates with the name, color and the only Team, then closes", async () => {
    const created: unknown[] = [];
    let open = true;
    render(
      <TooltipProvider delayDuration={0}>
        <CreateProjectDialog
          open
          teams={[MOCK_PROJECT_TEAMS[0]!]}
          onOpenChange={(next) => {
            open = next;
          }}
          onCreate={async (input) => {
            created.push(input);
            return true;
          }}
        />
      </TooltipProvider>,
    );
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Brand book " } });
    await act(async () => {
      fireEvent.click(create);
    });
    expect(created).toEqual([
      { teamSlug: "design", name: "Brand book", color: expect.any(String) },
    ]);
    expect(open).toBe(false);
  });
});
