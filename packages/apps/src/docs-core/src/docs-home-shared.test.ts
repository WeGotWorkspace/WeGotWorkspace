import { describe, expect, it } from "vitest";
import type { DriveFile } from "@/lib/files/drive-models";
import {
  docsHomeBrowsePathPrefix,
  docsHomeCreateJumpsToPersonal,
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleExtension,
  isDocsHomeCompatibleSharedFile,
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
    expect(docsHomeBrowsePathPrefix({ type: "recent" })).toBeUndefined();
    expect(docsHomeBrowsePathPrefix({ type: "starred" })).toBeUndefined();
    expect(docsHomeBrowsePathPrefix({ type: "trash" })).toBeUndefined();
    expect(docsHomeBrowsePathPrefix({ type: "drive", pathPrefix: "users/alice" })).toBe(
      "users/alice",
    );
  });
});

describe("docsHomeCreateJumpsToPersonal", () => {
  it("opens Personal first from Shared with me, Recent, Starred and Trash only", () => {
    for (const type of ["shared", "recent", "starred", "trash"] as const) {
      expect(docsHomeCreateJumpsToPersonal({ type })).toBe(true);
    }
    expect(docsHomeCreateJumpsToPersonal({ type: "all" })).toBe(false);
    expect(docsHomeCreateJumpsToPersonal({ type: "drive", pathPrefix: "groups/team" })).toBe(false);
  });
});
