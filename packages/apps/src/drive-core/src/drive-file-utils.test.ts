import { describe, expect, it } from "vitest";
import {
  canBrowserPreviewImage,
  driveFileForSharedWithMeListing,
  driveFileFromEntry,
  driveFileFromSharedWithMeEntry,
  extensionFromFileName,
  formatBytesCompact,
  inferFileKindFromName,
  suggestNewMarkdownFileName,
} from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import { SHARED_WITH_ME_UI_ROOT } from "@/drive-core/src/drive-path-utils";

function file(title: string, kind: DriveFile["kind"] = "doc"): DriveFile {
  return {
    id: title,
    notebook: "",
    category: "",
    date: "",
    title,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind,
    size: "1 KB",
  };
}

describe("canBrowserPreviewImage", () => {
  it("allows common browser-renderable image extensions", () => {
    expect(canBrowserPreviewImage("photo.PNG")).toBe(true);
    expect(canBrowserPreviewImage("icon.svg")).toBe(true);
  });

  it("rejects formats browsers typically cannot render inline", () => {
    expect(canBrowserPreviewImage("scan.heic")).toBe(false);
    expect(canBrowserPreviewImage("notes.txt")).toBe(false);
  });
});

describe("inferFileKindFromName", () => {
  it("classifies files by extension", () => {
    expect(inferFileKindFromName("cover.jpg")).toBe("image");
    expect(inferFileKindFromName("clip.mp4")).toBe("video");
    expect(inferFileKindFromName("song.flac")).toBe("audio");
    expect(inferFileKindFromName("bundle.zip")).toBe("archive");
    expect(inferFileKindFromName("brief.pdf")).toBe("doc");
    expect(inferFileKindFromName("data.bin")).toBe("file");
  });
});

describe("extensionFromFileName", () => {
  it("returns lowercase extension without leading dot", () => {
    expect(extensionFromFileName("Report.PDF")).toBe("pdf");
    expect(extensionFromFileName("README")).toBe("");
  });
});

describe("formatBytesCompact", () => {
  it("formats byte counts compactly", () => {
    expect(formatBytesCompact(0)).toBe("0 B");
    expect(formatBytesCompact(1500)).toBe("1.5 KB");
    expect(formatBytesCompact(2048)).toBe("2.0 KB");
    expect(formatBytesCompact(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytesCompact(1_500_000)).toBe("1.4 MB");
  });
});

describe("suggestNewMarkdownFileName", () => {
  it("returns Untitled.md when unused", () => {
    expect(suggestNewMarkdownFileName([])).toBe("Untitled.md");
  });

  it("increments suffix until unique among non-folder titles", () => {
    const files = [file("Untitled.md"), file("Untitled 2.md")];
    expect(suggestNewMarkdownFileName(files)).toBe("Untitled 3.md");
  });

  it("does not treat folder titles as file name collisions", () => {
    const files = [file("Untitled.md", "folder")];
    expect(suggestNewMarkdownFileName(files)).toBe("Untitled.md");
  });
});

describe("driveFileFromEntry isShared", () => {
  it("maps hasShares from directory listing entries", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/report.md",
        name: "report.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
        hasShares: true,
      },
      "alice",
    );
    expect(mapped.isShared).toBe(true);
  });

  it("maps granular share flags from directory listing entries", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/report.md",
        name: "report.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
        hasShares: true,
        hasPublicShare: true,
        hasTeamShare: true,
      },
      "alice",
    );
    expect(mapped.hasPublicShare).toBe(true);
    expect(mapped.hasTeamShare).toBe(true);
    expect(mapped.isShared).toBe(true);
  });

  it("leaves isShared undefined when hasShares is absent", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/private.md",
        name: "private.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
      },
      "alice",
    );
    expect(mapped.isShared).toBeUndefined();
  });

  it("maps mayManageStructure from directory listing myRights", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/shared.md",
        name: "shared.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: { ...fullDriveMyRights, mayManageStructure: false, mayShare: false },
      },
      "alice",
    );
    expect(mapped.mayManageStructure).toBe(false);
    expect(mapped.mayShare).toBe(false);
  });
});

describe("driveFileForSharedWithMeListing", () => {
  it("pins resolved entries under the Shared with me virtual root", () => {
    const mapped = driveFileForSharedWithMeListing(
      {
        type: "dir",
        path: "/users/bob/Client Deck",
        name: "Client Deck",
        size: 0,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
      },
      "alice",
    );
    expect(mapped.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped.apiPath).toBe("/users/bob/Client Deck");
    expect(mapped.kind).toBe("folder");
    expect(mapped.location).toBe("Shared by bob");
    expect(mapped.isShared).toBe(true);
    expect(mapped.hasTeamShare).toBeUndefined();
  });
});

describe("driveFileFromSharedWithMeEntry", () => {
  it("prefers the resolved entry over synthesizing from the share path", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          myRights: fullDriveMyRights,
        },
        entry: {
          type: "file",
          path: "/users/admin/Jaap.md",
          name: "Jaap.md",
          size: 42,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      "wouter",
    );
    expect(mapped?.title).toBe("Jaap.md");
    expect(mapped?.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped?.size).toBe("42 B");
    expect(mapped?.location).toBe("Shared by admin");
    expect(mapped?.isShared).toBe(true);
    expect(mapped?.hasTeamShare).toBeUndefined();
  });

  it("prefers share.ownerUsername over the path owner segment", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          ownerUsername: "hana",
          myRights: fullDriveMyRights,
        },
        entry: {
          type: "file",
          path: "/users/admin/Jaap.md",
          name: "Jaap.md",
          size: 42,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      "wouter",
    );
    expect(mapped?.location).toBe("Shared by hana");
  });

  it("falls back to the share path when entry metadata is absent", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          myRights: fullDriveMyRights,
          updatedAt: "2026-08-05T10:00:00.000Z",
        },
      },
      "wouter",
    );
    expect(mapped?.title).toBe("Jaap.md");
    expect(mapped?.apiPath).toBe("/users/admin/Jaap.md");
    expect(mapped?.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped?.location).toBe("Shared by admin");
  });
});
