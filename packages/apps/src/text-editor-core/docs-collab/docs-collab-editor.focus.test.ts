import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "docs-collab-editor.tsx"), "utf8");

describe("DocsCollabEditor mount focus", () => {
  it("focuses end without scrolling the caret into view", () => {
    expect(tsx).toMatch(/autofocus: false/);
    expect(tsx).toMatch(/scrollIntoView:\s*false/);
    expect(tsx).toMatch(/mountAutofocusRef/);
    // TipTap's built-in autofocus="end" would scroll long notes mid-page.
    expect(tsx).not.toMatch(/autofocus:\s*autofocus\s*\?\?\s*\(editable\s*\?\s*"end"/);
  });
});
