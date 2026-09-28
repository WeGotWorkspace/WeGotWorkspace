import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import {
  getSettingsPanel,
  panelForApp,
  panelsForNav,
  registerPanel,
  registerSlice,
  resetSettingsRegistryForTests,
  slicesFor,
} from "@/settings-core/src/settings-registry";

describe("settings-registry", () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  afterEach(() => {
    resetSettingsRegistryForTests();
  });

  it("hides a panel when zero slices are reachable", () => {
    registerPanel({
      id: "empty-app",
      label: "Empty",
      description: "",
      icon: null,
      group: "apps",
    });
    expect(panelsForNav({}).map((panel) => panel.id)).not.toContain("empty-app");
  });

  it("hides a slice when its gate is not === true", () => {
    registerPanel({
      id: "gated",
      label: "Gated",
      description: "",
      icon: null,
      group: "apps",
    });
    registerSlice({
      id: "gated-slice",
      panelIds: ["gated"],
      reachable: (ctx) => ctx.mcpEnabled === true,
      render: () => null,
    });
    expect(slicesFor("gated", {}).map((slice) => slice.id)).toEqual([]);
    expect(panelsForNav({}).map((panel) => panel.id)).not.toContain("gated");
    expect(slicesFor("gated", { mcpEnabled: true }).map((slice) => slice.id)).toEqual([
      "gated-slice",
    ]);
  });

  it("hides Assistants unless mcpEnabled === true", () => {
    registerBuiltinSettings();
    expect(panelsForNav({}).map((panel) => panel.id)).not.toContain("assistants");
    expect(panelsForNav({ mcpEnabled: false }).map((panel) => panel.id)).not.toContain(
      "assistants",
    );
    expect(panelsForNav({ mcpEnabled: true }).map((panel) => panel.id)).toContain("assistants");
  });

  it("keeps Mail under Apps with no production Notifications panel", () => {
    registerBuiltinSettings();
    const nav = panelsForNav({});
    expect(nav.filter((panel) => panel.group === "apps").map((panel) => panel.id)).toEqual([
      "mail",
    ]);
    expect(nav.map((panel) => panel.id)).not.toContain("notifications");
    expect(panelForApp("mail", {})?.id).toBe("mail");
    expect(panelForApp("notes", {})).toBeUndefined();
  });

  it("returns the same test-only dual-placement slice from two panel queries", () => {
    registerBuiltinSettings();
    registerSlice({
      id: "test-dual-notify",
      panelIds: ["mail", "notifications"],
      render: () => null,
    });
    expect(slicesFor("mail", {}).map((slice) => slice.id)).toContain("test-dual-notify");
    expect(slicesFor("notifications", {}).map((slice) => slice.id)).toEqual(["test-dual-notify"]);
    expect(panelsForNav({}).map((panel) => panel.id)).not.toContain("notifications");
  });

  it("throws on a foreign duplicate panel or slice id", () => {
    registerBuiltinSettings();
    expect(() =>
      registerPanel({
        id: "mail",
        label: "Mail",
        description: "",
        icon: null,
        group: "apps",
      }),
    ).toThrow(/already registered/);
    expect(() =>
      registerSlice({
        id: "mail-accounts",
        panelIds: ["mail"],
        render: () => null,
      }),
    ).toThrow(/already registered/);
  });

  it("treats a second registerBuiltinSettings call as a no-op", () => {
    registerBuiltinSettings();
    expect(() => registerBuiltinSettings()).not.toThrow();
    expect(getSettingsPanel("mail")?.id).toBe("mail");
  });

  it("clears the builtin flag so reset then register restores builtins", () => {
    registerBuiltinSettings();
    resetSettingsRegistryForTests();
    expect(getSettingsPanel("mail")).toBeUndefined();
    registerBuiltinSettings();
    expect(getSettingsPanel("mail")?.id).toBe("mail");
    expect(panelsForNav({}).map((panel) => panel.id)).toContain("profile");
  });
});
