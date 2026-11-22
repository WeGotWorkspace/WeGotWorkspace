import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskList } from "@/lib/models/tasks-types";
import { useTasksProjectScope } from "@/tasks-core/src/use-tasks-project-scope";

let ids: string[] | null = null;
vi.mock("@/lib/projects/use-project-filter", () => ({ useSelectedProjectIds: () => ids }));

const lists = [
  { id: "inbox", projectId: null },
  { id: "a", projectId: "p1" },
  { id: "b", projectId: "p2" },
  { id: "x", projectId: "p9" },
] as unknown as TaskList[];

const shown = () =>
  renderHook(() => useTasksProjectScope(lists)).result.current.visibleLists.map((l) => l.id);

describe("Tasks list scope for a Team filter", () => {
  it("shows every Project of the Team and nothing of another Team", () => {
    ids = ["p1", "p2"];
    expect(shown()).toEqual(["a", "b"]);
  });
  it("keeps a single Project and All Projects", () => {
    ids = ["p1"];
    expect(shown()).toEqual(["a"]);
    ids = null;
    expect(shown()).toEqual(["inbox", "a", "b", "x"]);
  });
});
