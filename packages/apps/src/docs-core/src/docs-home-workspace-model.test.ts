import { describe, expect, it } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import {
  docsHomeCreateDocumentApiPath,
  docsHomeEmptyIconKind,
  docsHomeEmptyMessage,
  docsHomeHeaderTitle,
  docsHomeOfflineBadgePendingIds,
  docsHomeOfflineSyncingIds,
  docsHomeViewFlags,
  filterDocsHomeVisibleFiles,
  resolveDocsHomeFiles,
  resolveDocsHomeListingStatus,
  type DocsHomeListingStatus,
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

const loadMore = () => {};

function status(
  overrides: Partial<Parameters<typeof resolveDocsHomeListingStatus>[0]> = {},
): DocsHomeListingStatus {
  return resolveDocsHomeListingStatus({
    isSharedView: false,
    isStarredView: false,
    isTrashView: false,
    isAllView: false,
    usesBrowseList: false,
    shareOperationsEnabled: false,
    browseLoading: false,
    browseError: null,
    browseLoadingMore: false,
    browseHasMore: false,
    browseIsOfflineListing: false,
    browseLoadMore: loadMore,
    sharedLoading: false,
    sharedError: null,
    starredLoading: false,
    starredError: null,
    trashLoading: false,
    trashError: null,
    ...overrides,
  });
}

describe("docsHomeViewFlags", () => {
  it("turns on browse and shared merge for All docs", () => {
    expect(docsHomeViewFlags({ type: "all" })).toMatchObject({
      isAllView: true,
      includeSharedInListing: true,
      usesBrowseList: true,
      isSharedView: false,
    });
  });

  it("browses a drive without merging shares", () => {
    const flags = docsHomeViewFlags({ type: "drive", pathPrefix: "groups/eng" });
    expect(flags.usesBrowseList).toBe(true);
    expect(flags.includeSharedInListing).toBe(false);
    expect(flags.isDriveView).toBe(true);
  });

  it("keeps recent on the browse list and shared, starred, and trash off it", () => {
    expect(docsHomeViewFlags({ type: "recent" }).usesBrowseList).toBe(true);
    expect(docsHomeViewFlags({ type: "shared" })).toMatchObject({
      isSharedView: true,
      includeSharedInListing: true,
      usesBrowseList: false,
    });
    expect(docsHomeViewFlags({ type: "starred" }).usesBrowseList).toBe(false);
    expect(docsHomeViewFlags({ type: "trash" }).isTrashView).toBe(true);
  });
});

describe("resolveDocsHomeFiles", () => {
  const browse = [file({ id: "a", title: "A", apiPath: "/users/alice/A.md" })];
  const shared = [file({ id: "b", title: "B", apiPath: "/users/bob/B.md" })];
  const starred = [file({ id: "c", title: "C", apiPath: "/users/alice/C.md" })];
  const trash = [file({ id: "d", title: "D", apiPath: "/users/alice/.Trash/D.md" })];
  const base = {
    browseFiles: browse,
    sharedFiles: shared,
    starredFiles: starred,
    trashFiles: trash,
    isSharedView: false,
    isStarredView: false,
    isTrashView: false,
    isAllView: false,
  };

  it("returns the active list by reference", () => {
    expect(resolveDocsHomeFiles({ ...base, isSharedView: true })).toBe(shared);
    expect(resolveDocsHomeFiles({ ...base, isStarredView: true })).toBe(starred);
    expect(resolveDocsHomeFiles({ ...base, isTrashView: true })).toBe(trash);
    expect(resolveDocsHomeFiles(base)).toBe(browse);
  });

  it("merges shared docs into All docs and lets browse win on the same path", () => {
    const sharedCopy = file({
      id: "shared-a",
      title: "A shared",
      apiPath: "/users/alice/A.md",
      isShared: true,
      location: "Bob",
    });
    const merged = resolveDocsHomeFiles({
      ...base,
      isAllView: true,
      sharedFiles: [sharedCopy, ...shared],
    });
    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged[0]).toMatchObject({ isShared: true, location: "Bob" });
  });
});

describe("resolveDocsHomeListingStatus", () => {
  it("waits for shares on All docs only when share operations are wired", () => {
    expect(
      status({
        isAllView: true,
        usesBrowseList: true,
        shareOperationsEnabled: true,
        browseLoading: false,
        sharedLoading: true,
        browseHasMore: true,
        browseLoadingMore: true,
        browseIsOfflineListing: true,
        browseError: "browse",
        sharedError: "shared",
      }),
    ).toMatchObject({
      loading: true,
      loadingMore: true,
      hasMore: true,
      isOfflineListing: true,
      error: "browse",
      loadMore,
    });

    expect(
      status({
        isAllView: true,
        usesBrowseList: true,
        shareOperationsEnabled: false,
        browseLoading: false,
        sharedLoading: true,
      }).loading,
    ).toBe(false);
  });

  it("uses the virtual list for shared, starred, and trash and ignores browse paging", () => {
    expect(
      status({
        isSharedView: true,
        sharedLoading: true,
        sharedError: "shared",
        browseHasMore: true,
        browseIsOfflineListing: true,
      }),
    ).toMatchObject({
      loading: true,
      error: "shared",
      hasMore: false,
      loadingMore: false,
      isOfflineListing: false,
    });
    expect(status({ isStarredView: true, starredError: "starred" }).error).toBe("starred");
    expect(status({ isTrashView: true, trashLoading: true, browseLoading: false }).loading).toBe(
      true,
    );
  });
});

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
    expect(docsHomeHeaderTitle({ type: "all" }, docsLabels, drives)).toBe(docsLabels.homeTitle);
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
});

describe("docs home offline badges", () => {
  const rows = [file({ id: "1", title: "One" }), file({ id: "2", title: "Two" })];

  it("marks only files that are not already available while body sync runs", () => {
    expect([...docsHomeOfflineSyncingIds(rows, false, new Set(["1"]))]).toEqual([]);
    expect([...docsHomeOfflineSyncingIds(rows, true, new Set(["1"]))]).toEqual(["2"]);
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
