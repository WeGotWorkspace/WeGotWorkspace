import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "use-notes-mutations.tsx"), "utf8");

describe("useNotesMutations star toast", () => {
  it("does not show a regular Starred toast when queueing the undoable mutation", () => {
    const toggleStar = source.slice(
      source.indexOf("const toggleStar = useCallback"),
      source.indexOf("const toggleArchive = useCallback"),
    );
    expect(toggleStar).toMatch(/if \(!operations\) \{\s*show\(/);
    expect(toggleStar).toMatch(/queueMutation\(\{/);
    // Live path must not also call show("Starred"|"Unstarred").
    const afterOperationsGuard = toggleStar.slice(toggleStar.indexOf("queueMutation"));
    expect(afterOperationsGuard).not.toMatch(/\bshow\(/);
  });
});
