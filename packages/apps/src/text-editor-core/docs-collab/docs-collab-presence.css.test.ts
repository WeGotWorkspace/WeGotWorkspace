import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const presenceCss = readFileSync(join(here, "docs-collab-presence.css"), "utf8");
const chromeCss = readFileSync(join(here, "docs-collab-presence-chrome.css"), "utf8");
const presenceTsx = readFileSync(join(here, "docs-collab-presence.tsx"), "utf8");
const chromeTsx = readFileSync(join(here, "docs-collab-presence-chrome.tsx"), "utf8");
const notesCss = readFileSync(
  join(here, "../../note-detail-view/src/note-text-editor-body.css"),
  "utf8",
);
const docsCss = readFileSync(join(here, "../../docs-core/src/docs-workspace.css"), "utf8");

describe("docs-collab presence avatar chrome", () => {
  it("keeps a single UserAvatar mark border — no cream/background wrapper ring", () => {
    expect(presenceCss).not.toMatch(/docs-collab-presence__avatar[\s\S]*box-shadow/);
    expect(presenceCss).not.toMatch(/--docs-collab-presence-ring/);
    expect(chromeCss).not.toMatch(/box-shadow/);
    expect(chromeCss).not.toMatch(/--docs-collab-presence-ring/);
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

  it("shared chrome owns Users icon + Online collaborators tooltip", () => {
    expect(chromeTsx).toMatch(/Online collaborators/);
    expect(chromeTsx).toMatch(/<Users\b/);
    expect(chromeTsx).toMatch(/DocsCollabPresence/);
  });

  it("shared chrome uses soft cream wash — not solid accent or 55% sidebar chip", () => {
    // Canonical self-avatar policy: 18%/24% accent→cream via outline-active tokens.
    // Apps only set --docs-collab-presence-accent (notes-accent / docs-accent).
    expect(chromeCss).toMatch(
      /\.docs-collab-presence-chrome \{[\s\S]*--button-outline-active-background:[\s\S]*--docs-collab-presence-accent[\s\S]*18%/,
    );
    expect(chromeCss).toMatch(
      /\.docs-collab-presence-chrome \{[\s\S]*--button-outline-active-hover-background:[\s\S]*--docs-collab-presence-accent[\s\S]*24%/,
    );
    expect(chromeCss).not.toMatch(
      /\.docs-collab-presence-chrome \{[\s\S]*--button-outline-active-background:[\s\S]*55%/,
    );
    expect(chromeCss).not.toMatch(/--user-avatar-bg:/);
    expect(chromeCss).toMatch(
      /\.docs-collab-presence-chrome \{[\s\S]*--user-avatar-fg:\s*var\(--color-ink\)/,
    );

    expect(notesCss).toMatch(
      /\.notes-workspace \.docs-collab-presence-chrome \{[\s\S]*--docs-collab-presence-accent:\s*var\(--notes-accent/,
    );
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-accent/);
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-detail-tint/);
    expect(notesCss).not.toMatch(/--user-avatar-bg:\s*var\(--notes-detail-accent/);

    expect(docsCss).toMatch(
      /\.docs-workspace \.docs-collab-presence-chrome \{[\s\S]*--docs-collab-presence-accent:\s*var\(--docs-accent/,
    );
    // Docs must not solid-fill self with --docs-accent (match Notes softness).
    expect(docsCss).not.toMatch(
      /\.docs-collab-presence__avatar--self[\s\S]*--user-avatar-bg:\s*var\(--docs-accent/,
    );
    expect(docsCss).not.toMatch(/--user-avatar-bg:\s*var\(--docs-accent/);
  });
});
