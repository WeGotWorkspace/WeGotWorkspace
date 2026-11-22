// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { createProjectsStore } from "@/lib/projects/projects-store";

beforeEach(() => localStorage.clear());

async function loadedStore() {
  const store = createProjectsStore(createMockProjectOperations());
  await store.load();
  return store;
}

const website = (store: Awaited<ReturnType<typeof loadedStore>>) =>
  store.getSnapshot().projects.find((project) => project.name === "Website relaunch")!;

describe("projects store: manage", () => {
  it("patches name and color in place and keeps the Team name", async () => {
    const store = await loadedStore();
    const before = website(store);
    await store.patch(before.id, { name: "Relaunch", color: "#ef4444" });
    const after = store.getSnapshot().projects.find((project) => project.id === before.id)!;
    expect(after).toMatchObject({ name: "Relaunch", color: "#ef4444", teamName: "Design" });
  });

  it("archives a Project out of the active list and into the archived one", async () => {
    const store = await loadedStore();
    const { id } = website(store);
    await store.archive(id);
    const snapshot = store.getSnapshot();
    expect(snapshot.projects.some((project) => project.id === id)).toBe(false);
    expect(snapshot.archived.map((project) => project.id)).toEqual([id]);
  });

  it("restores an archived Project", async () => {
    const store = await loadedStore();
    const { id } = website(store);
    await store.archive(id);
    await store.unarchive(id);
    const snapshot = store.getSnapshot();
    expect(snapshot.archived).toEqual([]);
    expect(snapshot.projects.some((project) => project.id === id)).toBe(true);
  });

  it("loads the archived Projects", async () => {
    const operations = createMockProjectOperations();
    const store = createProjectsStore(operations);
    await store.load();
    const { id } = website(store);
    await store.archive(id);
    await store.load();
    expect(store.getSnapshot().archived).toHaveLength(1);
    await store.loadArchived();
    expect(store.getSnapshot().archived.map((project) => project.teamName)).toEqual(["Design"]);
  });

  it("answers 409 for the default Project and a patch of an archived one", async () => {
    const store = await loadedStore();
    const defaultProject = store.getSnapshot().projects.find((project) => project.isDefault)!;
    const active = website(store);
    await expect(store.archive(defaultProject.id)).rejects.toMatchObject({ status: 409 });
    await store.archive(active.id);
    await expect(store.patch(active.id, { name: "Late" })).rejects.toMatchObject({ status: 409 });
    // A refusal leaves the snapshot as it was.
    expect(store.getSnapshot().projects.some((project) => project.id === defaultProject.id)).toBe(
      true,
    );
  });

  it("keeps the archived list through a reload of the active ones", async () => {
    const store = await loadedStore();
    await store.archive(website(store).id);
    await store.load();
    expect(store.getSnapshot().archived).toHaveLength(1);
  });
});
