// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocsProjectScope } from "@/docs-core/src/use-docs-project-scope";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { writeProjectFilter } from "@/lib/projects/project-filter";
import { createProjectsStore, resetProjectsStoreForTests } from "@/lib/projects/projects-store";

const drives = [
  { key: "mine", label: "My files", pathPrefix: "users/me" },
  { key: "design", label: "Design", pathPrefix: "groups/design" },
];

beforeEach(() => localStorage.clear());
afterEach(() => {
  resetProjectsStoreForTests();
  localStorage.clear();
});

describe("useDocsProjectScope", () => {
  async function withStore() {
    const store = createProjectsStore(createMockProjectOperations());
    await store.load();
    resetProjectsStoreForTests(store);
  }

  it("keeps every drive under All Projects", async () => {
    await withStore();
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useDocsProjectScope({ drives, view: { type: "all" }, selectView }),
    );
    expect(result.current).toEqual(drives);
    expect(selectView).not.toHaveBeenCalled();
  });

  it("shows the whole Team Drive and opens it under a Team filter", async () => {
    await withStore();
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useDocsProjectScope({ drives, view: { type: "all" }, selectView }),
    );
    act(() => writeProjectFilter("t:design"));
    expect(result.current).toEqual([
      { key: "groups/design", label: "Design", pathPrefix: "groups/design" },
    ]);
    expect(selectView).toHaveBeenCalledWith({ type: "drive", pathPrefix: "groups/design" });
  });

  it("does not move a reload off its view while the Projects are still loading", async () => {
    const probe = createProjectsStore(createMockProjectOperations());
    await probe.load();
    const stored = probe.getSnapshot().projects.find((p) => p.name === "Website relaunch");
    const store = createProjectsStore(createMockProjectOperations());
    resetProjectsStoreForTests(store);
    writeProjectFilter(`p:${stored?.id}`);
    const selectView = vi.fn();
    renderHook(() =>
      useDocsProjectScope({ view: { type: "recent" }, drives: [], selectView } as never),
    );
    await act(async () => {
      await store.load();
    });
    expect(selectView).not.toHaveBeenCalled();
  });
});
