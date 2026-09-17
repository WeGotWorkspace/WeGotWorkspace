import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, "use-meet-chat-call.ts"), "utf8");

describe("useMeetChatCall startCall", () => {
  it("passes startCall options into joinRoom so audio-only can keep the camera off", () => {
    expect(ts).toContain("joinRoom(room, options)");
  });

  it("joins unmatched ad-hoc rooms without routing through the guest gate", () => {
    expect(ts).toContain("joinAdHocRoom");
    expect(ts).toContain("adHocRoomChannelIdsRef");
    expect(ts).toMatch(/await controllerRef\.current\.joinRoom\(room\)/);
  });
});
