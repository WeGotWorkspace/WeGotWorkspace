import { describe, expect, it } from "vitest";
import { BUILTIN_PANEL_IDS } from "@/lib/models/settings-types";

describe("BUILTIN_PANEL_IDS", () => {
  it("lists each built-in Settings panel once, Profile first and About last", () => {
    expect(BUILTIN_PANEL_IDS[0]).toBe("profile");
    expect(BUILTIN_PANEL_IDS[BUILTIN_PANEL_IDS.length - 1]).toBe("about");
    expect(new Set(BUILTIN_PANEL_IDS).size).toBe(BUILTIN_PANEL_IDS.length);
  });

  it("has a panel for every app with per-app preferences", () => {
    expect(BUILTIN_PANEL_IDS).toEqual(
      expect.arrayContaining(["calendar", "tasks", "contacts", "notes", "docs", "meet"]),
    );
  });
});
