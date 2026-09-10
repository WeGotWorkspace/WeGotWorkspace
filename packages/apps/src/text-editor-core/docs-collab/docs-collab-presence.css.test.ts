import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const presenceCss = readFileSync(join(here, "docs-collab-presence.css"), "utf8");
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
});
