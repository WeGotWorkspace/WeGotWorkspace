import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEET_CALL_CHAT_PANEL_FLEX_MIN } from "@/meet-core/src/meet-call-chat-panel";
import { SIDEBAR_DOCKED_MIN_PX } from "@/workspace-shell/src/sidebar-breakpoint";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "meet-call-chat-panel.ts"), "utf8");

describe("meet call chat panel", () => {
  it("flexes at the same 1160px sidebar: dock Calendar inbox uses", () => {
    expect(MEET_CALL_CHAT_PANEL_FLEX_MIN).toBe("72.5rem");
    expect(SIDEBAR_DOCKED_MIN_PX).toBe(1160);
    expect(source).toMatch(/!isSidebarOverlayViewport\(\)/);
  });
});
