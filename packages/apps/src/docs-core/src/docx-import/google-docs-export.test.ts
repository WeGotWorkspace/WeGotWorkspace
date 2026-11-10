// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readDocxFixture } from "@/docs-core/src/docx-import/__tests__/fixtures/docx-fixtures";
import { buildDocxImportReport } from "@/docs-core/src/docx-import/docx-import-report";
import { scanDocx } from "@/docs-core/src/docx-import/docx-scan";
import { convertDocxToMarkdown } from "@/docs-core/src/docx-import/docx-to-markdown";

// A file shaped like Google Docs' File → Download → Microsoft Word (.docx) (#1615).
const googleExport = readDocxFixture("google-export.docx");

describe("a Google Docs Word export", () => {
  it("maps Title to heading 1 and Subtitle to a plain paragraph", async () => {
    const { markdown } = await convertDocxToMarkdown(googleExport);
    // Heading 1 stays level 1 next to the Title: levels are kept, not shifted.
    expect(markdown).toMatch(/^# Project brief\n\nWritten in Google Docs\n\n# Goals\n/);
    expect(markdown).toContain("\n## Budget\n");
  });

  it("keeps nested lists, the table, the image and the link", async () => {
    const { markdown, images } = await convertDocxToMarkdown(googleExport);
    expect(markdown).toMatch(/- Ship the beta\n\s+- Invite ten teams\n- Collect feedback/);
    // Google marks no header row, so the table keeps the editor's HTML form.
    expect(markdown).toContain("<td><p>Phase</p></td><td><p>Weeks</p></td>");
    expect(markdown).toContain(`![Team photo](${images[0].placeholder})`);
    // Google's direct underline on links is dropped.
    expect(markdown).toContain("Details on [the project site](https://example.com/project).");
    expect(images).toHaveLength(1);
    expect(markdown).not.toContain("data:");
  });

  it("applies pending suggestions, and the report says so; comments are reported, not merged", async () => {
    const { markdown } = await convertDocxToMarkdown(googleExport);
    expect(markdown).toContain("We plan three sprints starting in June.");
    expect(markdown).not.toContain("May");
    expect(markdown).not.toContain("Is three enough?");

    const scan = scanDocx(googleExport);
    if (!scan.ok) throw new Error(scan.refusal);
    const report = buildDocxImportReport("Project brief.docx", scan.counts, 0);
    expect(report.lines.map((line) => `${line.count} ${line.label}`)).toEqual([
      "1 comment",
      "2 tracked changes (accepted in the text)",
      "1 font",
      "1 text colour",
    ]);
  });
});
