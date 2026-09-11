import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(join(here, "docs-collab-workspace.tsx"), "utf8");

function actionsBlock(): string {
  const match = workspace.match(/<DocsHeaderActions[\s\S]*?actions=\{\[([\s\S]*?)\]\}/);
  expect(match?.[1]).toBeDefined();
  return match![1];
}

describe("DocsCollabWorkspace header Edit/Suggest + review gap", () => {
  it("mounts DocsCollabSuggestControls in DocsHeaderActions leading, not the format bar", () => {
    expect(workspace).toMatch(
      /leading=\{\s*permissions\.editable \? \(\s*<DocsCollabSuggestControls/,
    );
    expect(workspace).toMatch(
      /<DocsCollabSuggestControls editor=\{editor\} disabled=\{viewSource\}/,
    );
    expect(workspace).not.toMatch(/showSuggestControls/);
    expect(workspace).not.toMatch(/trailing=\{[\s\S]*DocsCollabSuggestControls/);
    expect(workspace).not.toMatch(/text-editor-format-bar__mode-trigger/);
  });

  it("forces Edit mode when viewSource turns on", () => {
    expect(workspace).toMatch(/getTrackChangesMode\(editor\) !== "suggest"/);
    expect(workspace).toMatch(/editor\.commands\.setEditMode\(\)/);
    expect(workspace).toMatch(/\[editor, viewSource\]/);
  });

  it("pins review toggle to ViewHeader titleTrailing like Calendar inbox", () => {
    expect(workspace).toMatch(/titleTrailing=\{\s*<IconButton[\s\S]*docs-workspace__review-toggle/);
    const block = actionsBlock();
    expect(block).not.toMatch(/id:\s*"review"/);
    expect(block).not.toMatch(/docs-workspace__review-toggle/);
  });

  it("orders actions print → share? → view-source (last, left of review toggle)", () => {
    const block = actionsBlock();
    const printIdx = block.indexOf('id: "print"');
    const viewSourceIdx = block.indexOf('id: "view-source"');
    const shareIdx = block.indexOf('id: "share"');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(viewSourceIdx).toBeGreaterThan(printIdx);
    if (shareIdx >= 0) {
      expect(shareIdx).toBeGreaterThan(printIdx);
      expect(viewSourceIdx).toBeGreaterThan(shareIdx);
    }
  });

  it("disables print while viewSource is on", () => {
    const block = actionsBlock();
    expect(block).toMatch(/id:\s*"print"[\s\S]*?disabled:\s*!editor \|\| viewSource/);
  });
});
