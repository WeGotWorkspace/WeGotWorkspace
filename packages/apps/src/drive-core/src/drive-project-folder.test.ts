import type { WorkspaceProject } from "@/lib/projects/projects-store";
import { describe, expect, it } from "vitest";
import {
  driveFolderIcon,
  isProjectFolder,
  isProjectFolderUiPath,
  projectsWithFolder,
} from "@/drive-core/src/drive-project-folder";

const project = (over: Record<string, unknown> = {}): WorkspaceProject =>
  ({
    isDefault: false,
    archived: false,
    resources: { driveFolderId: "node-1", driveFolderPath: "/groups/eng/Launch" },
    ...over,
  }) as unknown as WorkspaceProject;

describe("isProjectFolder", () => {
  it("matches by node id or by API path", () => {
    const projects = [project()];
    expect(isProjectFolder({ id: "node-1" }, projects)).toBe(true);
    expect(isProjectFolder({ id: "x", apiPath: "/groups/eng/Launch/" }, projects)).toBe(true);
    expect(isProjectFolder({ id: "x", apiPath: "/groups/eng/Other" }, projects)).toBe(false);
  });

  it("ignores the default Project (no folder of its own) and archived Projects", () => {
    const projects = [project({ isDefault: true }), project({ archived: true })];
    expect(projectsWithFolder(projects)).toEqual([]);
    expect(isProjectFolder({ id: "node-1", apiPath: "/groups/eng/Launch" }, projects)).toBe(false);
  });

  it("matches a Drive UI path", () => {
    expect(isProjectFolderUiPath("Groups/eng/Launch", [project()])).toBe(true);
    expect(isProjectFolderUiPath("Groups/eng", [project()])).toBe(false);
  });

  it("uses the Project icon only for Project folders", () => {
    expect(driveFolderIcon(true)).not.toBe(driveFolderIcon(false));
  });
});
