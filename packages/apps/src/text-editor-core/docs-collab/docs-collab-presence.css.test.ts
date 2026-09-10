import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const presenceCss = readFileSync(join(here, "docs-collab-presence.css"), "utf8");
const presenceTsx = readFileSync(join(here, "docs-collab-presence.tsx"), "utf8");
const notesCss = readFileSync(
  join(here, "../../note-detail-view/src/note-text-editor-body.css"),
  "utf8",
);
const docsCss = readFileSync(join(here, "../../docs-core/src/docs-workspace.css"), "utf8");

describe("docs-collab presence avatar chrome", () => {
  it("keeps a single UserAvatar mark border — no cream/background wrapper ring", () => {
    expect(presenceCss).not.toMatch(/docs-collab-presence__avatar[\s\S]*box-shadow/);
    expect(presenceCss).not.toMatch(/--docs-collab-presence-ring/);
    expect(notesCss).not.toMatch(
      /\.docs-collab-presence__avatar--self[\s\S]*\.user-avatar__mark[\s\S]*box-shadow/,
    );
    expect(notesCss).not.toMatch(/--docs-collab-presence-ring/);
    expect(docsCss).not.toMatch(
      /\.docs-collab-presence__avatar--self[\s\S]*\.user-avatar__mark[\s\S]*box-shadow/,
    );
    expect(docsCss).not.toMatch(/--docs-collab-presence-ring/);
  });

  it("omits color= on peer marks so wash matches sidebar outline-active", () => {
    // Per-user .user-avatar--colored tiles read hotter than Notes/Docs sidebar
    // UserAvatar (plain outline-active). Presence peers stay uncolored.
    expect(presenceTsx).not.toMatch(/avatarColorForUserId/);
    expect(presenceTsx).not.toMatch(/\bcolor=\{/);
  });

  it("Notes collab chrome uses soft cream wash — not solid accent or 55% sidebar chip", () => {
    // Self used to set --user-avatar-bg: var(--notes-accent) (full #f6d176).
    // Peers inherited workspace 55% outline-active — loud on white detail footer.
    expect(notesCss).not.toMatch(
      /\.docs-collab-presence__avatar--self[\s\S]*--user-avatar-bg:\s*var\(--notes-accent/,
    );
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-accent/);
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-detail-tint/);
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-detail-accent/);
    expect(notesCss).toMatch(
      /\.notes-workspace \.note-detail-view__collab-chrome \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--notes-accent[^)]*\) 18%/,
    );
    expect(notesCss).toMatch(
      /\.notes-workspace \.note-detail-view__collab-chrome \{[\s\S]*--button-outline-active-hover-background:[\s\S]*var\(--notes-accent[^)]*\) 24%/,
    );
    expect(notesCss).not.toMatch(
      /\.note-detail-view__collab-chrome \{[\s\S]*--button-outline-active-background:[\s\S]*55%/,
    );
  });
});
