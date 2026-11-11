import { describe, expect, it } from "vitest";
import {
  canBrowserPreviewImage,
  extensionFromFileName,
  formatBytesCompact,
  inferFileKindFromName,
  parseFileSizeBytes,
} from "@/lib/files/file-name-utils";

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

describe("parseFileSizeBytes", () => {
  it("reads the listed size back into bytes", () => {
    expect(parseFileSizeBytes({ kind: "file", size: "512 B" })).toBe(512);
    expect(parseFileSizeBytes({ kind: "file", size: "1.5 KB" })).toBe(1536);
    expect(parseFileSizeBytes({ kind: "video", size: "100 MB" })).toBe(100 * 1024 * 1024);
    expect(parseFileSizeBytes({ kind: "video", size: "4.0 GB" })).toBe(4 * 1024 * 1024 * 1024);
  });

  it("has no size for a folder and zero for an empty listing", () => {
    expect(parseFileSizeBytes({ kind: "folder", size: "—" })).toBeNull();
    expect(parseFileSizeBytes({ kind: "file", size: "—" })).toBe(0);
  });
});
