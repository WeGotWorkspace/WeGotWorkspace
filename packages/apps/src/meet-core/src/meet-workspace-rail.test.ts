import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const rail = readFileSync(join(here, "meet-workspace-rail.tsx"), "utf8");

describe("MeetWorkspaceRail", () => {
  it("places an sm subtle back IconButton in titleLeading before the title", () => {
    expect(rail).toMatch(/titleLeading=/);
    expect(rail).toMatch(/ChevronLeft/);
    expect(rail).toMatch(/size="sm"/);
    expect(rail).toMatch(/variant="subtle"/);
    expect(rail).toMatch(/onBack/);
    expect(rail).toMatch(/backLabel/);
    expect(rail).toMatch(/headerActions=\{headerActions\}/);
  });
});
