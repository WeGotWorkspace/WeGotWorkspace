import type { WorkspaceProject } from "@/lib/projects/projects-store";
import { describe, expect, it } from "vitest";
import {
  driveFolderIcon,
  isProjectFolder,
  isProjectFolderUiPath,
  projectOfFolder,
  projectsWithFolder,
} from "@/drive-core/src/drive-project-folder";

const project = (over: Record<string, unknown> = {}): WorkspaceProject =>
  ({
    isDefault: false,
    archived: false,
    resources: { driveFolderId: "node-1", driveFolderPath: "/groups/eng/Launch" },
    ...over,
  }) as unknown as WorkspaceProject;

describe("projectOfFolder", () => {
  it("returns the Project (and so its color) whose folder this is", () => {
    const launch = project({ id: "p1", color: "#3366ff" });
    expect(projectOfFolder({ id: "node-1" }, [launch])).toBe(launch);
    expect(projectOfFolder({ id: "other" }, [launch])).toBeNull();
    expect(projectOfFolder({ id: "node-1" }, [project({ archived: true })])).toBeNull();
  });
});

describe("isProjectFolder", () => {
  it("matches by node id or by API path", () => {
    const projects = [project()];
    expect(isProjectFolder({ id: "node-1" }, projects)).toBe(true);
    expect(isProjectFolder({ id: "x", apiPath: "/groups/eng/Launch/" }, projects)).toBe(true);
    expect(isProjectFolder({ id: "x", apiPath: "/groups/eng/Other" }, projects)).toBe(false);
  });

  it("counts the default Project's folder and ignores archived Projects", () => {
    const projects = [project({ archived: true })];
    expect(projectsWithFolder(projects)).toEqual([]);
    expect(isProjectFolder({ id: "node-1", apiPath: "/groups/eng/Launch" }, projects)).toBe(false);
    const withDefault = project({
      isDefault: true,
      resources: { driveFolderId: "node-0", driveFolderPath: "/groups/eng/Eng Project" },
    });
    expect(projectsWithFolder([withDefault])).toHaveLength(1);
    expect(isProjectFolder({ id: "node-0" }, [withDefault])).toBe(true);
    expect(isProjectFolderUiPath("Groups/eng/Eng Project", [withDefault])).toBe(true);
  });

  it("matches a Drive UI path", () => {
    expect(isProjectFolderUiPath("Groups/eng/Launch", [project()])).toBe(true);
    expect(isProjectFolderUiPath("Groups/eng", [project()])).toBe(false);
  });

  it("uses the Project icon only for Project folders", () => {
    expect(driveFolderIcon(true)).not.toBe(driveFolderIcon(false));
  });
});
