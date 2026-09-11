import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "use-drive-mutations.tsx"), "utf8");

describe("useDriveMutations star toast", () => {
  it("keeps a single undoable toast on the live star path (no parallel show)", () => {
    const toggleStar = source.slice(
      source.indexOf("const toggleStar = (id: string)"),
      source.indexOf("const commitMoveToFolder"),
    );
    expect(toggleStar).toMatch(/if \(!operations\) \{\s*show\(/);
    expect(toggleStar).toMatch(/queueMutation\(\{/);
    expect(toggleStar).toMatch(/toastMessage: nextValue \? "Starred"/);
    // Live path must not also call show("Starred"|"Unstarred").
    const afterOperationsGuard = toggleStar.slice(toggleStar.indexOf("queueMutation"));
    expect(afterOperationsGuard).not.toMatch(/\bshow\(/);
  });
});
