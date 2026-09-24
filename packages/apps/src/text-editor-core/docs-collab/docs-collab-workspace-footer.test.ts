import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(join(here, "docs-collab-workspace.tsx"), "utf8");

describe("DocsCollabWorkspace detail footer presence", () => {
  it("mounts DocsCollabPresenceChrome in WorkspaceDetailFooter start, not header leading", () => {
    const headerActions = workspace.match(
      /<DocsHeaderActions\s+leading=\{([\s\S]*?)\}\s+actions=\{/,
    );
    expect(headerActions).toBeTruthy();
    expect(headerActions![1]).not.toMatch(/DocsCollabPresence/);
    expect(headerActions![1]).not.toMatch(/showPendingSyncIndicator/);
    expect(headerActions![1]).not.toMatch(/LoadingSpinner/);
    expect(headerActions![1]).not.toMatch(/docs-workspace__pending-sync/);
    expect(headerActions![1]).toMatch(/DocsCollabSuggestControls/);

    expect(workspace).toMatch(
      /<WorkspaceDetailFooter[\s\S]*start=\{\s*collabSession \? \(\s*<DocsCollabPresenceChrome/,
    );
    expect(workspace).toMatch(/detailFooterLastEditedTag/);
    expect(workspace).toMatch(/formatDocLastEdited\(lastSavedAt\)/);
    expect(workspace).toMatch(/editedLabel:\s*labels\.editedLabel/);
    expect(workspace).toMatch(/busy:\s*showPendingSyncIndicator/);
    expect(workspace).toMatch(/busyLabel:\s*pendingSyncLabel/);
    expect(workspace).toMatch(/footerDocStatus \? <DocsDocStatus status=\{footerDocStatus\}/);
    expect(workspace).toMatch(/isToastDocStatus/);
    expect(workspace).toMatch(/showSuccess\(docStatus\)/);
    expect(workspace).toMatch(/showError\(docStatus\)/);
    expect(workspace).not.toMatch(/formatSavedDocStatus/);
  });
});
