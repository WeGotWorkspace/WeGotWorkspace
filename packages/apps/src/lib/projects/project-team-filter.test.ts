import { describe, expect, it } from "vitest";
import {
  effectiveProjectFilter,
  parseProjectFilter,
  projectIdOfFilter,
  teamFilterValue,
  teamSlugOfFilter,
} from "@/lib/projects/project-filter";
import {
  collectionsInProject,
  projectIdsInScope,
  selectedProject,
  selectedTeamSlug,
} from "@/lib/projects/project-match";
import type { WorkspaceProject } from "@/lib/projects/projects-store";

const project = (id: string, teamSlug: string, isDefault = false) =>
  ({ id, teamSlug, isDefault, name: id, teamName: teamSlug }) as WorkspaceProject;
const projects = [
  project("a", "design", true),
  project("b", "design"),
  project("c", "sales", true),
];

describe("Team filter", () => {
  it("parses and tells a Team from a Project", () => {
    expect(parseProjectFilter("t:design")).toBe("t:design");
    expect(parseProjectFilter("t:")).toBe("all");
    expect(teamSlugOfFilter(teamFilterValue("design"))).toBe("design");
    expect(projectIdOfFilter("t:design")).toBeNull();
    expect(teamSlugOfFilter("p:a")).toBeNull();
  });

  it("scopes to every Project of the Team, or one Project, or nothing", () => {
    expect(projectIdsInScope("t:design", projects)).toEqual(["a", "b", "team:design"]);
    expect(projectIdsInScope("p:b", projects)).toEqual(["b"]);
    expect(projectIdsInScope("all", projects)).toBeNull();
    expect(selectedProject("t:design", projects)).toBeNull();
    expect(selectedTeamSlug("t:design", projects)).toBe("design");
    expect(selectedTeamSlug("p:c", projects)).toBe("sales");
    expect(selectedTeamSlug("all", projects)).toBeNull();
  });

  it("keeps collections of any Project in scope", () => {
    const collections = [{ projectId: "a" }, { projectId: "b" }, { projectId: "c" }, {}];
    expect(collectionsInProject(collections, ["a", "b"])).toHaveLength(2);
    expect(collectionsInProject(collections, "c")).toHaveLength(1);
    expect(collectionsInProject(collections, null)).toHaveLength(4);
  });

  it("falls back to All Projects when the Team has no Project left", () => {
    const ids = new Set(["a", "b"]);
    expect(effectiveProjectFilter("t:design", ids, new Set(["design"]))).toBe("t:design");
    expect(effectiveProjectFilter("t:sales", ids, new Set(["design"]))).toBe("all");
    expect(effectiveProjectFilter("t:sales", null, null)).toBe("t:sales");
  });

  it("a Team keeps its collections in no Project, and Personal keeps what has no Team", () => {
    const collections = [
      { id: "own", projectId: "a" },
      { id: "other", projectId: "c" },
      { id: "team-loose", groupSlug: "design" },
      { id: "other-team-loose", groupSlug: "sales" },
      { id: "mine" },
    ];
    expect(
      collectionsInProject(collections, projectIdsInScope("t:design", projects)).map((c) => c.id),
    ).toEqual(["own", "team-loose"]);
    expect(
      collectionsInProject(collections, projectIdsInScope("personal", projects)).map((c) => c.id),
    ).toEqual(["mine"]);
    expect(collectionsInProject(collections, ["a"]).map((c) => c.id)).toEqual(["own"]);
  });
});
