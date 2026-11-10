import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDocsDownload } from "@/docs-core/src/use-docs-download";

describe("useDocsDownload", () => {
  it("offers the Markdown download only for Markdown Docs", () => {
    const md = renderHook(() => useDocsDownload(null, "a.md", "markdown"));
    expect(md.result.current.downloadMarkdown).toBeTypeOf("function");
    for (const format of ["text", "html"] as const) {
      const other = renderHook(() => useDocsDownload(null, "a.txt", format));
      expect(other.result.current.downloadMarkdown).toBeUndefined();
    }
  });
});
