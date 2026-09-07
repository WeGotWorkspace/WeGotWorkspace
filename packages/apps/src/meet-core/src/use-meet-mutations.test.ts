import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, "use-meet-mutations.ts"), "utf8");

describe("useMeetMutations joinRoom", () => {
  it("turns video off before capture when join is audio-only", () => {
    expect(ts).toContain("if (options?.video === false) room.setVideoOn(false)");
    expect(ts.indexOf("setVideoOn(false)")).toBeLessThan(ts.indexOf("await ensureLocalMedia()"));
  });
});
