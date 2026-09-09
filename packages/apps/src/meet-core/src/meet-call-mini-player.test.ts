import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const miniPlayer = readFileSync(join(here, "meet-call-mini-player.tsx"), "utf8");
const miniPlayerCss = readFileSync(join(here, "meet-call-mini-player.css"), "utf8");

describe("MeetCallMiniPlayer return to call", () => {
  it("navigates to the live nested Meet route instead of /meet?room=", () => {
    expect(miniPlayer).toContain("meetResumeCallNavigateTarget");
    expect(miniPlayer).toContain("meetCallMiniPlayerVisible");
    expect(miniPlayer).not.toContain("meetSearchFromRoom");
    expect(miniPlayer).not.toMatch(/to:\s*"\/meet"/);
  });

  it("lets the user drag the card without treating action clicks as a drag", () => {
    expect(miniPlayer).toContain("meetClampMiniPlayerPosition");
    expect(miniPlayer).toContain("meetMiniPlayerDragExceededThreshold");
    expect(miniPlayer).toContain("setMiniPlayerPosition");
    expect(miniPlayer).toContain("setPointerCapture");
    expect(miniPlayer).toContain('closest(".meet-mini-player__actions")');
    expect(miniPlayer).toContain("meet-mini-player--dragging");
  });

  it("uses tabular nums for the timer line and does not show a group icon", () => {
    expect(miniPlayer).not.toMatch(/<Users\b/);
    expect(miniPlayer).not.toContain("participantsShort");
    expect(miniPlayer).not.toContain("in call");
    expect(miniPlayerCss).toMatch(/\.meet-mini-player__meta[\s\S]*tabular-nums/);
  });
});
