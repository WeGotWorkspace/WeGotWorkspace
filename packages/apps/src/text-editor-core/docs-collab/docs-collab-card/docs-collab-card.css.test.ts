import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cardCss = readFileSync(join(here, "docs-collab-card.css"), "utf8");
const commentsFloatingCss = readFileSync(
  join(here, "../docs-comments/docs-comments-floating-layer.css"),
  "utf8",
);
const suggestionsFloatingCss = readFileSync(
  join(here, "../docs-suggestions/docs-suggestions-floating-layer.css"),
  "utf8",
);
const docsWorkspaceCss = readFileSync(
  join(here, "../../../docs-core/src/docs-workspace.css"),
  "utf8",
);
const replyCss = readFileSync(join(here, "docs-collab-message-reply.css"), "utf8");

describe("docs collab card chrome", () => {
  it("uses a 1px border and button-pill radius with no drop shadow", () => {
    expect(cardCss).toMatch(
      /\.docs-collab-card \{[\s\S]*border-radius:\s*var\(--control-radius-button-pill\)/,
    );
    expect(cardCss).toMatch(/\.docs-collab-card \{[\s\S]*@apply cursor-pointer border p-4/);
    expect(cardCss).not.toMatch(/shadow-sm/);
    expect(cardCss).not.toMatch(/box-shadow/);
    expect(cardCss).not.toMatch(/rounded-xl/);
    expect(cardCss).not.toMatch(/border-2/);
  });

  it("does not add drop shadows on floating comment or suggestion cards", () => {
    expect(commentsFloatingCss).not.toMatch(/box-shadow/);
    expect(suggestionsFloatingCss).not.toMatch(/box-shadow/);
    expect(docsWorkspaceCss).not.toMatch(/\.docs-comments-floating-layer__card[\s\S]*box-shadow/);
  });

  it("stacks reply timestamps under the author, matching card meta", () => {
    expect(replyCss).toMatch(
      /\.docs-collab-message-reply__header,[\s\S]*@apply flex flex-col gap-0\.5/,
    );
    expect(replyCss).not.toMatch(/\.docs-collab-message-reply__header,[\s\S]*items-baseline/);
    expect(cardCss).toMatch(/\.docs-collab-card__meta \{[\s\S]*flex-col gap-0\.5/);
  });
});
