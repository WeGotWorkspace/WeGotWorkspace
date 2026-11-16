import { describe, expect, it } from "vitest";
import { BUILTIN_PANEL_IDS } from "@/lib/models/settings-types";

describe("settings-types", () => {
  it("lists the built-in panels", () => {
    expect(BUILTIN_PANEL_IDS).toContain("profile");
  });
});
