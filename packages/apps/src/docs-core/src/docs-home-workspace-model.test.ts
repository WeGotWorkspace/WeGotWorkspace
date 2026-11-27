import { describe, expect, it } from "vitest";
import type { DriveFile } from "@/lib/files/drive-models";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import {
  docsHomeCreateDocumentApiPath,
  docsHomeEmptyIconKind,
  docsHomeEmptyMessage,
  docsHomeHeaderTitle,
  docsHomePaneOfflineLabels,
  docsHomeOfflineBadgePendingIds,
  docsHomeOfflineSyncingIds,
  filterDocsHomeVisibleFiles,
} from "@/docs-core/src/docs-home-workspace-model";

function file(partial: Partial<DriveFile> & { id: string; title: string }): DriveFile {
  return {
    category: "document",
    date: "Now",
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "1 KB",
    ...partial,
  };
}

const drives = [
  { pathPrefix: "users/alice", label: "Personal" },
  { pathPrefix: "groups/eng", label: "Engineering" },
];

describe("docs home chrome", () => {
  it("picks the header title from the view, then the selected drive", () => {
    expect(docsHomeHeaderTitle({ type: "shared" }, docsLabels, drives)).toBe(
      docsLabels.homeSharedWithMe,
    );
    expect(docsHomeHeaderTitle({ type: "recent" }, docsLabels, drives)).toBe(docsLabels.homeRecent);
    expect(docsHomeHeaderTitle({ type: "starred" }, docsLabels, drives)).toBe(
      docsLabels.homeStarred,
    );
    expect(docsHomeHeaderTitle({ type: "trash" }, docsLabels, drives)).toBe(docsLabels.homeTrash);
    expect(docsHomeHeaderTitle({ type: "all" }, docsLabels, drives)).toBe(docsLabels.homeAllDocs);
    expect(
      docsHomeHeaderTitle({ type: "drive", pathPrefix: "groups/eng" }, docsLabels, drives),
    ).toBe("Engineering");
    expect(
      docsHomeHeaderTitle({ type: "drive", pathPrefix: "groups/missing" }, docsLabels, drives),
    ).toBe(docsLabels.homeTitle);
  });

  it("picks empty copy and icon kind, with no icon for All docs and drives", () => {
    const views: DocsHomeView[] = [
      { type: "shared" },
      { type: "recent" },
      { type: "starred" },
      { type: "trash" },
      { type: "all" },
      { type: "drive", pathPrefix: "users/alice" },
    ];
    expect(views.map((view) => docsHomeEmptyMessage(view, docsLabels))).toEqual([
      docsLabels.homeSharedEmpty,
      docsLabels.homeRecentEmpty,
      docsLabels.homeStarredEmpty,
      docsLabels.homeTrashEmpty,
      docsLabels.homeEmpty,
      docsLabels.homeEmpty,
    ]);
    expect(views.map((view) => docsHomeEmptyIconKind(view))).toEqual([
      "share",
      "clock",
      "star",
      "trash",
      null,
      null,
    ]);
  });

  it("uses the syncing label only while body hydration is running", () => {
    expect(docsHomePaneOfflineLabels(docsLabels, false).offlinePendingSync).toBe(
      docsLabels.offlinePendingSync,
    );
    expect(docsHomePaneOfflineLabels(docsLabels, true)).toEqual({
      offlineAvailable: docsLabels.offlineAvailable,
      offlinePendingSync: docsLabels.syncingOffline,
    });
  });
});

describe("docs home offline badges", () => {
  const rows = [file({ id: "1", title: "One" }), file({ id: "2", title: "Two" })];

  it("marks only files that are not already available while body sync runs", () => {
    expect([...docsHomeOfflineSyncingIds(rows, false, new Set(["1"]))]).toEqual([]);
    expect([...docsHomeOfflineSyncingIds(rows, true, new Set(["1"]))]).toEqual(["2"]);
  });

  it("never marks Word files or Google links, which do not sync offline (#1983)", () => {
    const listed = [
      file({ id: "w", title: "Plan.docx" }),
      file({ id: "g", title: "Plan.gdoc" }),
      file({ id: "m", title: "Plan.md" }),
    ];
    expect([...docsHomeOfflineSyncingIds(listed, true, new Set())]).toEqual(["m"]);
  });

  it("returns the pending set unchanged when nothing is hydrating", () => {
    const pending = new Set(["a"]);
    expect(docsHomeOfflineBadgePendingIds(pending, new Set())).toBe(pending);
    expect([...docsHomeOfflineBadgePendingIds(new Set(["a"]), new Set(["b"]))].sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("filterDocsHomeVisibleFiles", () => {
  const rows = [
    file({ id: "hidden", title: "Hidden", apiPath: "/users/alice/Hidden.md" }),
    file({ id: "kept", title: "Kept", apiPath: "users/alice/Kept.md" }),
    file({ id: "nostar", title: "No star", apiPath: "/users/alice/No.md" }),
    file({ id: "nopath", title: "No path" }),
  ];

  it("drops hidden rows and keeps unstarred rows until stars settle", () => {
    const visible = filterDocsHomeVisibleFiles(rows, {
      hiddenFileIds: new Set(["hidden"]),
      isStarredView: true,
      starsReady: false,
      starredPaths: new Set(["/users/alice/Kept.md"]),
    });
    expect(visible.map((item) => item.id)).toEqual(["kept", "nostar", "nopath"]);
  });

  it("keeps only normalized starred paths once the star index is ready", () => {
    const visible = filterDocsHomeVisibleFiles(rows, {
      hiddenFileIds: new Set(["hidden"]),
      isStarredView: true,
      starsReady: true,
      starredPaths: new Set(["/users/alice/Kept.md"]),
    });
    expect(visible.map((item) => item.id)).toEqual(["kept"]);
  });

  it("does not apply the star filter outside Starred", () => {
    const visible = filterDocsHomeVisibleFiles(rows, {
      hiddenFileIds: new Set(),
      isStarredView: false,
      starsReady: true,
      starredPaths: new Set(),
    });
    expect(visible).toHaveLength(rows.length);
  });
});

describe("docsHomeCreateDocumentApiPath", () => {
  it("trims the name and resolves personal and group destinations", () => {
    expect(docsHomeCreateDocumentApiPath("  Notes.md  ", "My Drive", "alice", new Set())).toBe(
      "/users/alice/Notes.md",
    );
    expect(docsHomeCreateDocumentApiPath("Notes.md", "Groups/eng", "alice", new Set())).toBe(
      "/groups/eng/Notes.md",
    );
    expect(
      docsHomeCreateDocumentApiPath("Notes.md", "My Drive/eng", "alice", new Set(["eng"])),
    ).toBe("/groups/eng/Notes.md");
  });

  it("returns null when the name is blank", () => {
    expect(docsHomeCreateDocumentApiPath("   ", "My Drive", "alice", new Set())).toBeNull();
  });
});
