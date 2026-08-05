import { describe, expect, it } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveSharedWithMeEntry } from "@wgw-api-generated/drive-types";
import {
  docsHomeBrowsePathPrefix,
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleExtension,
  isDocsHomeCompatibleSharedFile,
  mapDocsHomeSharedEntries,
  mergeDocsHomeBrowseWithShared,
} from "@/docs-core/src/docs-home-shared";

function file(partial: Partial<DriveFile> & { id: string; title: string }): DriveFile {
  return {
    category: "document",
    date: "Now",
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "Shared with me",
    kind: "doc",
    size: "1 KB",
    ...partial,
  };
}

function sharedEntry(path: string, type: "file" | "dir", name: string): DriveSharedWithMeEntry {
  return {
    share: {
      id: `share-${name}`,
      path,
      kind: "member",
      defaultAccess: "view",
      publicToken: null,
      hasPassword: false,
      expiresAt: null,
      updatedAt: "2026-08-05T10:00:00.000Z",
      shareWith: null,
      myRights: fullDriveMyRights,
    },
    entry: {
      type,
      path,
      name,
      size: type === "dir" ? 0 : 42,
      time: 1,
      permissions: 0,
      myRights: fullDriveMyRights,
    },
  };
}

describe("isDocsHomeCompatibleExtension", () => {
  it("allows Docs home browse extensions", () => {
    expect(isDocsHomeCompatibleExtension("notes.md")).toBe(true);
    expect(isDocsHomeCompatibleExtension("notes.markdown")).toBe(true);
    expect(isDocsHomeCompatibleExtension("notes.txt")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isDocsHomeCompatibleExtension("clip.mov")).toBe(false);
    expect(isDocsHomeCompatibleExtension("deck.pdf")).toBe(false);
    expect(isDocsHomeCompatibleExtension("README")).toBe(false);
  });
});

describe("isDocsHomeCompatibleSharedFile", () => {
  it("rejects folders even when the name looks like a document", () => {
    expect(
      isDocsHomeCompatibleSharedFile(
        file({ id: "1", title: "Notes.md", kind: "folder", apiPath: "/users/bob/Notes.md" }),
      ),
    ).toBe(false);
  });

  it("accepts markdown and txt files", () => {
    expect(
      isDocsHomeCompatibleSharedFile(
        file({ id: "1", title: "Plan.md", apiPath: "/users/bob/Plan.md" }),
      ),
    ).toBe(true);
    expect(
      isDocsHomeCompatibleSharedFile(
        file({ id: "2", title: "Standup.txt", apiPath: "/users/bob/Standup.txt" }),
      ),
    ).toBe(true);
  });
});

describe("mapDocsHomeSharedEntries", () => {
  it("keeps docs-compatible files and drops folders and binaries", () => {
    const entries = [
      sharedEntry("/users/hana/Shared Notes.md", "file", "Shared Notes.md"),
      sharedEntry("/users/hana/Client Deck", "dir", "Client Deck"),
      sharedEntry("/users/hana/Walkthrough.mov", "file", "Walkthrough.mov"),
      sharedEntry("/users/hana/Brief.txt", "file", "Brief.txt"),
    ];
    const files = mapDocsHomeSharedEntries(entries, "alice");
    expect(files.map((item) => item.title)).toEqual(["Shared Notes.md", "Brief.txt"]);
    expect(files.every((item) => item.parent === "Shared with me")).toBe(true);
    expect(files.every((item) => item.location === "Shared by hana")).toBe(true);
    expect(files.every((item) => item.isShared === true)).toBe(true);
    expect(files.every((item) => item.hasTeamShare !== true)).toBe(true);
  });
});

describe("filterDocsHomeSharedByQuery", () => {
  it("filters by title case-insensitively", () => {
    const files = [file({ id: "1", title: "Roadmap.md" }), file({ id: "2", title: "Standup.txt" })];
    expect(filterDocsHomeSharedByQuery(files, "road").map((item) => item.id)).toEqual(["1"]);
    expect(filterDocsHomeSharedByQuery(files, "  ").map((item) => item.id)).toEqual(["1", "2"]);
  });
});

describe("docsHomeBrowsePathPrefix", () => {
  it("returns the drive prefix only for drive views", () => {
    expect(docsHomeBrowsePathPrefix({ type: "all" })).toBeUndefined();
    expect(docsHomeBrowsePathPrefix({ type: "shared" })).toBeUndefined();
    expect(docsHomeBrowsePathPrefix({ type: "drive", pathPrefix: "users/alice" })).toBe(
      "users/alice",
    );
  });
});

describe("mergeDocsHomeBrowseWithShared", () => {
  it("appends shared-only docs and dedupes by apiPath", () => {
    const browse = [
      file({ id: "b1", title: "Mine.md", apiPath: "/users/alice/Mine.md" }),
      file({
        id: "b2",
        title: "Shared Notes.md",
        apiPath: "/users/hana/Shared Notes.md",
        location: "My Drive",
        parent: "Users/hana",
      }),
    ];
    const shared = [
      file({
        id: "s1",
        title: "Shared Notes.md",
        apiPath: "/users/hana/Shared Notes.md",
        location: "Shared by hana",
        isShared: true,
      }),
      file({
        id: "s2",
        title: "Brief.txt",
        apiPath: "/users/hana/Brief.txt",
        location: "Shared by hana",
        isShared: true,
      }),
    ];
    const merged = mergeDocsHomeBrowseWithShared(browse, shared);
    expect(merged.map((item) => item.apiPath)).toEqual([
      "/users/alice/Mine.md",
      "/users/hana/Shared Notes.md",
      "/users/hana/Brief.txt",
    ]);
    expect(merged[1]).toMatchObject({
      location: "Shared by hana",
      parent: "Shared with me",
      isShared: true,
    });
  });
});
