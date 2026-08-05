import { describe, expect, it } from "vitest";
import {
  apiPathFromSearchSourceKey,
  driveFileFromSearchResult,
  driveLocationLabel,
  isSharedDriveApiPath,
  parentVirtualPath,
} from "@/drive-core/src/drive-search-utils";
import type { DriveUnifiedSearchResult } from "@/drive-core/src/drive-types";

describe("parentVirtualPath", () => {
  it("returns My Drive for single-segment UI paths", () => {
    expect(parentVirtualPath("My Drive/Studio Assets")).toBe("My Drive");
  });

  it("returns the parent folder for nested paths", () => {
    expect(parentVirtualPath("My Drive/Studio Assets/Proofs.pdf")).toBe("My Drive/Studio Assets");
  });
});

describe("apiPathFromSearchSourceKey", () => {
  it("normalizes source keys to API virtual paths", () => {
    expect(apiPathFromSearchSourceKey("users/alice/report.pdf")).toBe("/users/alice/report.pdf");
    expect(apiPathFromSearchSourceKey("/users/alice/report.pdf")).toBe("/users/alice/report.pdf");
  });

  it("returns null for empty keys", () => {
    expect(apiPathFromSearchSourceKey("")).toBeNull();
    expect(apiPathFromSearchSourceKey("   ")).toBeNull();
  });
});

describe("driveLocationLabel", () => {
  it("labels the viewer personal drive as My Drive", () => {
    expect(driveLocationLabel("users/alice/notes.md", "alice")).toBe("My Drive");
    expect(driveLocationLabel("users/alice/notes.md")).toBe("My Drive");
  });

  it("labels foreign personal drives as Shared by {owner}", () => {
    expect(driveLocationLabel("users/hana/Shared Notes.md", "alice")).toBe("Shared by hana");
  });

  it("labels group drives with the drive name only", () => {
    expect(driveLocationLabel("groups/engineering/rfc.md")).toBe("engineering");
  });

  it("returns null for unrecognized keys", () => {
    expect(driveLocationLabel("misc/file.md")).toBeNull();
  });
});

describe("isSharedDriveApiPath", () => {
  it("detects group storage paths", () => {
    expect(isSharedDriveApiPath("/groups/team/Documents/ROADMAP.md")).toBe(true);
    expect(isSharedDriveApiPath("groups/team/file.md")).toBe(true);
  });

  it("returns false for personal drive paths", () => {
    expect(isSharedDriveApiPath("/users/alice/notes.md")).toBe(false);
    expect(isSharedDriveApiPath(undefined)).toBe(false);
  });
});

describe("driveFileFromSearchResult", () => {
  it("maps unified search rows into drive list items", () => {
    const result: DriveUnifiedSearchResult = {
      id: 1,
      sourceType: "file",
      sourceKey: "users/alice/notes.md",
      title: "Meeting Notes",
      snippet: "Quarterly planning",
      category: "document",
      size: 2048,
      modifiedAt: 1_700_000_000,
    };

    const file = driveFileFromSearchResult(
      result,
      "My Drive/notes.md",
      "/users/alice/notes.md",
      "alice",
    );

    expect(file).toMatchObject({
      id: "search:file:users/alice/notes.md",
      title: "Meeting Notes",
      excerpt: "Quarterly planning",
      parent: "My Drive",
      kind: "doc",
      size: "2.0 KB",
      apiPath: "/users/alice/notes.md",
      location: "My Drive",
    });
    expect(file.date).toBe(new Date(1_700_000_000 * 1000).toLocaleDateString());
  });

  it("formats larger sizes in MB", () => {
    const result: DriveUnifiedSearchResult = {
      id: 3,
      sourceType: "file",
      sourceKey: "users/alice/deck.md",
      title: "Deck",
      size: 3_500_000,
    };
    const file = driveFileFromSearchResult(result, "My Drive/deck.md", "/users/alice/deck.md");
    expect(file.size).toBe("3.3 MB");
  });

  it("falls back to Now and an em dash for zero/unknown sizes", () => {
    const result: DriveUnifiedSearchResult = {
      id: 2,
      sourceType: "file",
      sourceKey: "users/alice/draft.md",
      title: "Draft",
      size: 0,
    };
    const file = driveFileFromSearchResult(result, "My Drive/draft.md", "/users/alice/draft.md");
    expect(file.date).toBe("Now");
    expect(file.size).toBe("—");
  });
});
