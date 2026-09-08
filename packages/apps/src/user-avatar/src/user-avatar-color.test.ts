import { describe, expect, it } from "vitest";
import { USER_AVATAR_COLORS, avatarColorForUserId } from "./user-avatar-color";

const FIXTURE_AUTHOR_IDS = [
  "ada.lovelace",
  "grace.hopper",
  "demo.user",
  "alan.turing",
  "katherine.johnson",
  "margaret.hamilton",
] as const;

describe("avatarColorForUserId", () => {
  it("returns a palette token", () => {
    expect(USER_AVATAR_COLORS).toContain(avatarColorForUserId("ada.lovelace"));
  });

  it("is stable for the same id", () => {
    expect(avatarColorForUserId("demo.user")).toBe(avatarColorForUserId("demo.user"));
  });

  it("assigns distinct colors to Meet chat fixture authors", () => {
    const colors = FIXTURE_AUTHOR_IDS.map((id) => avatarColorForUserId(id));
    expect(new Set(colors).size).toBe(FIXTURE_AUTHOR_IDS.length);
  });

  it("falls back to the first palette token for a blank id", () => {
    expect(avatarColorForUserId("")).toBe(USER_AVATAR_COLORS[0]);
    expect(avatarColorForUserId("   ")).toBe(USER_AVATAR_COLORS[0]);
  });
});
