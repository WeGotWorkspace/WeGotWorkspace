// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProjectOperations, MOCK_PROJECT_TEAMS } from "@/lib/api/mock/projects";
import { readProjectFilter } from "@/lib/projects/project-filter";
import { createProjectsStore } from "@/lib/projects/projects-store";
import { ProjectFilterSelect } from "@/projects-ui/src/project-filter-select";
import { OpenSettingsPanelContext } from "@/lib/settings/open-settings-panel";
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

  it("shows All Projects, then per Team its All and the other Projects", async () => {
    renderSelect(await loadedStore());
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger.textContent).toContain("All Projects");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual([
      "All Projects",
      "All in Design",
      "Design ProjectDefault",
      "Website relaunch",
      "All in Sales",
    ]);
    // No Settings around the filter here, so no Manage Projects.
  });

  it("lists the Teams' Projects for a member too", async () => {
    renderSelect(await loadedStore([{ slug: "sales", displayName: "Sales", isTeamAdmin: false }]));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual([
      "All Projects",
      "All in Sales",
      "Sales ProjectDefault",
      "Website relaunch",
    ]);
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

describe("Manage Projects", () => {
  function renderWithSettings(
    store: Awaited<ReturnType<typeof loadedStore>>,
    open: ((id: string) => void) | null,
  ) {
    return render(
      <TooltipProvider delayDuration={0}>
        <OpenSettingsPanelContext.Provider value={open}>
          <ProjectFilterSelect store={store} />
        </OpenSettingsPanelContext.Provider>
      </TooltipProvider>,
    );
  }

  it("opens the Projects panel for a team admin", async () => {
    const open = vi.fn();
    renderWithSettings(await loadedStore(), open);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "Manage Projects" }), {
      key: "Enter",
    });
    expect(open).toHaveBeenCalledWith("memberships");
    expect(readProjectFilter()).toBe("all");
  });

  it("is hidden without the role, and without Settings around it", async () => {
    renderWithSettings(
      await loadedStore([{ slug: "sales", displayName: "Sales", isTeamAdmin: false }]),
      vi.fn(),
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    expect(screen.queryByRole("option", { name: "Manage Projects" })).toBeNull();
    cleanup();
    renderWithSettings(await loadedStore(), null);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Project" }), { key: "Enter" });
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: "Manage Projects" })).toBeNull();
  });
});
