import { describe, expect, it } from "vitest";
import {
  canBrowserPreviewImage,
  driveFileFromEntry,
  extensionFromFileName,
  formatBytesCompact,
  inferFileKindFromName,
  suggestNewMarkdownFileName,
} from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";

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
});
