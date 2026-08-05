import { describe, expect, it } from "vitest";
import { filterDriveVisibleItems } from "@/drive-core/src/drive-visible-items";
import type { DriveFile } from "@/drive-core/src/drive-models";

const sampleFile = (overrides: Partial<DriveFile>): DriveFile => ({
  id: "f-1",
  notebook: "File",
  category: "File",
  date: "Now",
  title: "Notes.md",
  excerpt: "",
  body: [],
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "1 KB",
  ...overrides,
});

describe("filterDriveVisibleItems", () => {
  it("lists files in the active folder view", () => {
    const files = [
      sampleFile({ id: "a", title: "Alpha.md", parent: "My Drive" }),
      sampleFile({ id: "b", title: "Beta.md", parent: "Studio Assets" }),
    ];

    const visible = filterDriveVisibleItems({
      files,
      liveSearchResults: null,
      starredItems: null,
      starred: {},
      view: { type: "folder", path: "My Drive" },
      searchQuery: "",
      currentUsername: "demo",
      operations: undefined,
    });

    expect(visible.map((file) => file.id)).toEqual(["a"]);
  });

  it("filters by search query within the current view", () => {
    const files = [
      sampleFile({ id: "a", title: "Alpha.md", parent: "My Drive" }),
      sampleFile({ id: "b", title: "Beta.md", parent: "My Drive" }),
    ];

    const visible = filterDriveVisibleItems({
      files,
      liveSearchResults: null,
      starredItems: null,
      starred: {},
      view: { type: "folder", path: "My Drive" },
      searchQuery: "beta",
      currentUsername: "demo",
      operations: undefined,
    });

    expect(visible.map((file) => file.id)).toEqual(["b"]);
  });

  it("lists Shared with me mock files when operations are absent", () => {
    const files = [
      sampleFile({ id: "mine", title: "Mine.md", parent: "My Drive" }),
      sampleFile({ id: "shared", title: "Shared.md", parent: "Shared with me" }),
    ];

    const visible = filterDriveVisibleItems({
      files,
      liveSearchResults: null,
      starredItems: null,
      starred: {},
      view: { type: "shared" },
      searchQuery: "",
      currentUsername: "demo",
      operations: undefined,
    });

    expect(visible.map((file) => file.id)).toEqual(["shared"]);
  });

  it("uses sharedItems for the live Shared with me view", () => {
    const files = [sampleFile({ id: "mine", title: "Mine.md", parent: "My Drive" })];
    const sharedItems = [
      sampleFile({
        id: "/users/bob/deck",
        title: "Client Deck",
        parent: "Shared with me",
        kind: "folder",
        apiPath: "/users/bob/Client Deck",
      }),
    ];

    const visible = filterDriveVisibleItems({
      files,
      liveSearchResults: null,
      starredItems: null,
      sharedItems,
      starred: {},
      view: { type: "shared" },
      searchQuery: "",
      currentUsername: "demo",
      operations: {},
    });

    expect(visible.map((file) => file.id)).toEqual(["/users/bob/deck"]);
  });
});
