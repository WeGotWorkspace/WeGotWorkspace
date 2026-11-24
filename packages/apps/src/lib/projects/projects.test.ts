// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import type { ProjectOperations } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import {
  effectiveProjectFilter,
  parseProjectFilter,
  PROJECT_FILTER_STORAGE_KEY,
  readProjectFilter,
  subscribeProjectFilter,
  writeProjectFilter,
} from "@/lib/projects/project-filter";
import { collectionMatchesProjectFilter, projectOfCollection } from "@/lib/projects/project-match";
import {
  createProjectsStore,
  projectsByTeam,
  PROJECTS_CACHE_KEY,
} from "@/lib/projects/projects-store";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("project filter value", () => {
  it("reads only all or p:<id>", () => {
    expect(parseProjectFilter(null)).toBe("all");
    expect(parseProjectFilter("p:")).toBe("all");
    expect(parseProjectFilter("garbage")).toBe("all");
    expect(parseProjectFilter("p:01abc")).toBe("p:01abc");
  });

  it("stores the choice and tells this tab", () => {
    const listener = vi.fn();
    const stop = subscribeProjectFilter(listener);
    writeProjectFilter("p:01abc");
    expect(readProjectFilter()).toBe("p:01abc");
    expect(listener).toHaveBeenCalledTimes(1);
    writeProjectFilter("all");
    expect(localStorage.getItem(PROJECT_FILTER_STORAGE_KEY)).toBeNull();
    stop();
  });

  it("follows another tab through the storage event", () => {
    const listener = vi.fn();
    const stop = subscribeProjectFilter(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("falls back to all for a Project no longer listed, but not before the list loads", () => {
    expect(effectiveProjectFilter("p:gone", new Set(["p1"]))).toBe("all");
    expect(effectiveProjectFilter("p:p1", new Set(["p1"]))).toBe("p:p1");
    expect(effectiveProjectFilter("p:gone", null)).toBe("p:gone");
  });
});

describe("projects store", () => {
  it("loads Projects with their Team names and groups them, default first", async () => {
    const store = createProjectsStore(createMockProjectOperations());
    expect(await store.load()).toBe(true);
    const snapshot = store.getSnapshot();
    expect(snapshot.status).toBe("ready");
    const groups = projectsByTeam(snapshot);
    expect(groups.map((group) => group.team.displayName)).toEqual(["Design", "Sales"]);
    expect(groups[0]?.projects.map((project) => project.name)).toEqual([
      "Design Project",
      "Website relaunch",
    ]);
    expect(groups[0]?.projects[0]?.teamName).toBe("Design");
  });

  it("shares one request between concurrent loads", async () => {
    const operations = createMockProjectOperations();
    const list = vi.spyOn(operations, "list");
    const store = createProjectsStore(operations);
    await Promise.all([store.load(), store.load()]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("adds a created Project to the list", async () => {
    const store = createProjectsStore(createMockProjectOperations());
    await store.load();
    const created = await store.create({ teamSlug: "design", name: "Brand book" });
    expect(created.teamName).toBe("Design");
    expect(store.getSnapshot().projects.some((project) => project.name === "Brand book")).toBe(
      true,
    );
  });

  it("shows the last good list when the network fails", async () => {
    await createProjectsStore(createMockProjectOperations()).load();
    expect(localStorage.getItem(PROJECTS_CACHE_KEY)).not.toBeNull();
    const failing = failingOperations(new TypeError("Failed to fetch"));
    const store = createProjectsStore(failing);
    expect(await store.load()).toBe(false);
    expect(store.getSnapshot().status).toBe("offline");
    expect(store.getSnapshot().projects.length).toBe(3);
  });

  it("ignores a copy written by another account", async () => {
    await createProjectsStore(createMockProjectOperations(), () => "admin").load();
    const failing = failingOperations(new TypeError("Failed to fetch"));
    const other = createProjectsStore(failing, () => "grace");
    expect(await other.load()).toBe(false);
    expect(other.getSnapshot()).toMatchObject({ status: "error", projects: [] });
  });

  it("never shows the copy when signed out or forbidden", async () => {
    await createProjectsStore(createMockProjectOperations()).load();
    const store = createProjectsStore(failingOperations(new WgwRequestError("no", 401)));
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", projects: [] });
  });

  it("keeps the list on screen when a refresh fails", async () => {
    const operations = createMockProjectOperations();
    const store = createProjectsStore(operations);
    await store.load();
    vi.spyOn(operations, "list").mockRejectedValueOnce(new TypeError("offline"));
    expect(await store.load()).toBe(false);
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().projects.length).toBe(3);
  });
});

describe("project match", () => {
  it("narrows a collection to the selected Project", async () => {
    const store = createProjectsStore(createMockProjectOperations());
    await store.load();
    const { projects } = store.getSnapshot();
    const [first, second] = projects;
    if (!first || !second) throw new Error("seed");
    const filter = `p:${first.id}` as const;
    expect(collectionMatchesProjectFilter("all", projects, "calendarId", "anything")).toBe(true);
    expect(
      collectionMatchesProjectFilter(
        filter,
        projects,
        "calendarId",
        first.resources.calendarId ?? "",
      ),
    ).toBe(true);
    expect(
      collectionMatchesProjectFilter(
        filter,
        projects,
        "calendarId",
        second.resources.calendarId ?? "",
      ),
    ).toBe(false);
    expect(projectOfCollection(projects, "taskListId", second.resources.taskListId ?? "")?.id).toBe(
      second.id,
    );
  });
});

function failingOperations(error: unknown): ProjectOperations {
  const reject = () => Promise.reject(error);
  return {
    list: reject,
    listTeams: reject,
    create: reject,
    patch: reject,
    archive: reject,
    unarchive: reject,
    purge: reject,
  };
}
