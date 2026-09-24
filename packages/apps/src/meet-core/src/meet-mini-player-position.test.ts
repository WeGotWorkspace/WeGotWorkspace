import { describe, expect, it } from "vitest";
import {
  MEET_MINI_PLAYER_INSET,
  meetClampMiniPlayerPosition,
  meetMiniPlayerDefaultPosition,
  meetMiniPlayerDragExceededThreshold,
} from "@/meet-core/src/meet-mini-player-position";

describe("meetMiniPlayerDefaultPosition", () => {
  it("docks to the bottom-right inset", () => {
    expect(
      meetMiniPlayerDefaultPosition({
        viewportWidth: 1280,
        viewportHeight: 720,
        width: 320,
        height: 64,
      }),
    ).toEqual({
      x: 1280 - 320 - MEET_MINI_PLAYER_INSET,
      y: 720 - 64 - MEET_MINI_PLAYER_INSET,
    });
  });
});

describe("meetClampMiniPlayerPosition", () => {
  it("keeps the card inside the viewport inset", () => {
    expect(
      meetClampMiniPlayerPosition({
        x: -40,
        y: 900,
        viewportWidth: 800,
        viewportHeight: 600,
        width: 320,
        height: 64,
      }),
    ).toEqual({ x: MEET_MINI_PLAYER_INSET, y: 600 - 64 - MEET_MINI_PLAYER_INSET });
  });

  it("does not overflow the right or bottom edges", () => {
    expect(
      meetClampMiniPlayerPosition({
        x: 2000,
        y: 2000,
        viewportWidth: 800,
        viewportHeight: 600,
        width: 320,
        height: 64,
      }),
    ).toEqual({
      x: 800 - 320 - MEET_MINI_PLAYER_INSET,
      y: 600 - 64 - MEET_MINI_PLAYER_INSET,
    });
  });
});

describe("meetMiniPlayerDragExceededThreshold", () => {
  it("ignores small pointer jitter so a click still returns to the call", () => {
    expect(meetMiniPlayerDragExceededThreshold(2, 2)).toBe(false);
    expect(meetMiniPlayerDragExceededThreshold(4, 0)).toBe(true);
  });
});
