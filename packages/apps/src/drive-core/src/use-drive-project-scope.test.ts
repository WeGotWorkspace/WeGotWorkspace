// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docsProjectPathPrefix } from "@/docs-core/src/use-docs-project-scope";
import {
  driveProjectFolderUiPath,
  useDriveProjectScope,
} from "@/drive-core/src/use-drive-project-scope";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { writeProjectFilter } from "@/lib/projects/project-filter";
import { createProjectsStore, resetProjectsStoreForTests } from "@/lib/projects/projects-store";

const roots = [
  { path: "Groups/design", label: "Design" },
  { path: "Groups/sales", label: "Sales" },
];

const own = {
  isDefault: false,
  teamSlug: "design",
  resources: { driveFolderPath: "/groups/design/Website relaunch" },
} as never;
const teamDefault = { isDefault: true, teamSlug: "design", resources: {} } as never;

beforeEach(() => localStorage.clear());
afterEach(() => {
  resetProjectsStoreForTests();
  localStorage.clear();
});

describe("Project folder paths", () => {
  it("is the Project folder, or the Team Drive for a default Project", () => {
    expect(driveProjectFolderUiPath(own)).toBe("Groups/design/Website relaunch");
    expect(driveProjectFolderUiPath(teamDefault)).toBe("Groups/design");
    expect(docsProjectPathPrefix(own)).toBe("groups/design/Website relaunch");
    expect(docsProjectPathPrefix(teamDefault)).toBe("groups/design");
  });
});

describe("useDriveProjectScope", () => {
  async function withStore() {
    const store = createProjectsStore(createMockProjectOperations());
    await store.load();
    resetProjectsStoreForTests(store);
    return store;
  }

  it("keeps every root under All Projects", async () => {
    await withStore();
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useDriveProjectScope({ view: { type: "all" }, groupRoots: roots, selectView }),
    );
    expect(result.current).toEqual({ groupRoots: roots, hidePersonalDrive: false });
    expect(selectView).not.toHaveBeenCalled();
  });

  it("lists only the Project folder and opens it when the Project is chosen", async () => {
    const store = await withStore();
    const project = store.getSnapshot().projects.find((p) => p.name === "Website relaunch");
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useDriveProjectScope({ view: { type: "recent" }, groupRoots: roots, selectView }),
    );
    act(() => writeProjectFilter(`p:${project?.id}`));
    const path = "Groups/design/Website relaunch";
    expect(result.current).toEqual({
      groupRoots: [{ path, label: "Website relaunch" }],
      hidePersonalDrive: true,
    });
    expect(selectView).toHaveBeenCalledWith({ type: "folder", path });
  });
});
