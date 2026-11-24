import { describe, expect, it } from "vitest";
import {
  effectiveProjectFilter,
  isPersonalScope,
  parseProjectFilter,
} from "@/lib/projects/project-filter";
import { collectionsInProject, projectIdsInScope } from "@/lib/projects/project-match";

describe("Personal filter", () => {
  it("parses and survives an unknown-project check", () => {
    expect(parseProjectFilter("personal")).toBe("personal");
    expect(effectiveProjectFilter("personal", new Set(), new Set())).toBe("personal");
  });

  it("keeps only collections without a Project", () => {
    const scope = projectIdsInScope("personal", []);
    expect(isPersonalScope(scope)).toBe(true);
    const items: { id: string; projectId?: string | null }[] = [
      { id: "a" },
      { id: "b", projectId: null },
      { id: "c", projectId: "p1" },
    ];
    expect(collectionsInProject(items, scope).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("a Project scope never matches personal collections", () => {
    expect(collectionsInProject([{ projectId: null }], ["p1"])).toEqual([]);
  });
});
