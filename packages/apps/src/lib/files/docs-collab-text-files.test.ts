import { describe, expect, it } from "vitest";
import {
  DOCS_COLLAB_TEXT_EXTENSIONS,
  isDocsCollabEditablePath,
} from "@/lib/files/docs-collab-text-files";
import {
  docsEditorFormatFromFileName,
  isDocsPlainTextFile,
} from "@/text-editor-core/docs-collab/docs-editor-format";

describe("isDocsCollabEditablePath", () => {
  it("allows My Drive and group paths for allowlisted extensions", () => {
    expect(isDocsCollabEditablePath("/users/alice/notes.md")).toBe(true);
    expect(isDocsCollabEditablePath("/groups/team/config.yaml")).toBe(true);
    expect(isDocsCollabEditablePath("/groups/team/data.csv")).toBe(true);
  });

  it("rejects binaries and paths without an extension", () => {
    expect(isDocsCollabEditablePath("/users/alice/photo.png")).toBe(false);
    expect(isDocsCollabEditablePath("/users/alice/README")).toBe(false);
    expect(isDocsCollabEditablePath(null)).toBe(false);
  });

  it("matches the shared extension allowlist", () => {
    for (const ext of DOCS_COLLAB_TEXT_EXTENSIONS) {
      expect(isDocsCollabEditablePath(`/groups/team/file.${ext}`)).toBe(true);
    }
  });
});

describe("docsEditorFormatFromFileName", () => {
  it("maps markdown, html, and plain-text extensions", () => {
    expect(docsEditorFormatFromFileName("plan.md")).toBe("markdown");
    expect(docsEditorFormatFromFileName("plan.markdown")).toBe("markdown");
    expect(docsEditorFormatFromFileName("page.html")).toBe("html");
    expect(docsEditorFormatFromFileName("notes.txt")).toBe("text");
    expect(docsEditorFormatFromFileName("config.yaml")).toBe("text");
    expect(docsEditorFormatFromFileName("data.csv")).toBe("text");
  });

  it("treats plain-text formats via isDocsPlainTextFile", () => {
    expect(isDocsPlainTextFile("notes.txt")).toBe(true);
    expect(isDocsPlainTextFile("config.yml")).toBe(true);
    expect(isDocsPlainTextFile("plan.md")).toBe(false);
    expect(isDocsPlainTextFile("page.html")).toBe(false);
  });
});
