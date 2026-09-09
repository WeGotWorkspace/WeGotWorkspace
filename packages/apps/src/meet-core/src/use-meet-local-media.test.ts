import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, "use-meet-local-media.ts"), "utf8");

describe("useMeetLocalMedia ensureLocalMedia", () => {
  it("asks getUserMedia for camera only when video is on", () => {
    expect(ts).toContain("meetLocalMediaGumConstraints({");
    expect(ts).toMatch(/videoOn:\s*video/);
    expect(ts).not.toContain("audio: buildMeetAudioConstraints(selectedMicId ?? undefined)");
  });

  it("exposes force mute and unmute for host remote-mute controls", () => {
    expect(ts).toMatch(/const muteMic = useCallback\(\(\): boolean =>/);
    expect(ts).toMatch(/const unmuteMic = useCallback\(\(\): boolean =>/);
    expect(ts).toContain("unmuteMic,");
  });
});
