import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, "use-meet-chat-call.ts"), "utf8");

describe("useMeetChatCall startCall", () => {
  it("turns the camera off before joinRoom when startCall sets video false", () => {
    expect(ts).toMatch(
      /if \(options\?\.video === false\) \{\s*controllerRef\.current\.setVideoOn\(false\);\s*\}/,
    );
    expect(ts.indexOf("setVideoOn(false)")).toBeLessThan(ts.indexOf("joinRoom(room)"));
  });
});
