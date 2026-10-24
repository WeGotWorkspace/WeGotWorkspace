import { describe, expect, it, expectTypeOf } from "vitest";
import type { SettingsStateResponse } from "@wgw/openapi-types/settings-types";
import { mapWgwSettingsStateToUI } from "@/lib/api/wgw/settings";
import type { SettingsUIData } from "@/settings-core/src/settings-types";
import { assertFieldMappings } from "@/lib/api/contract/contract-assert";

/** Minimal OpenAPI-shaped fixture for settings state round-trip tests. */
const settingsStateFixture = {
  user: {
    username: "alice",
    displayName: "Alice Example",
    email: "alice@example.test",
  },
  groups: [
    { id: "g1", displayName: "Editors" },
    { id: "g2", displayName: "Readers" },
  ],
  logoutUrl: "/api/v1/auth/logout",
  mcpEnabled: true,
} satisfies SettingsStateResponse;

describe("settings UI ↔ OpenAPI contract", () => {
  describe("type-level parity", () => {
    it("maps SettingsStateResponse user fields 1:1 into SettingsUIData.user", () => {
      type UserFromApi = Pick<SettingsUIData["user"], keyof SettingsStateResponse["user"]>;
      expectTypeOf<UserFromApi>().toEqualTypeOf<SettingsStateResponse["user"]>();
    });

    it("maps SettingsStateResponse group rows 1:1 into SettingsUIData.groups", () => {
      type GroupFromApi = SettingsUIData["groups"][number];
      type ApiGroup = SettingsStateResponse["groups"][number];
      expectTypeOf<GroupFromApi>().toEqualTypeOf<ApiGroup>();
    });

    it("includes logoutUrl from SettingsStateResponse on SettingsUIData", () => {
      expectTypeOf<SettingsUIData["logoutUrl"]>().toEqualTypeOf<
        SettingsStateResponse["logoutUrl"]
      >();
    });

    it("includes mcpEnabled from SettingsStateResponse on SettingsUIData", () => {
      expectTypeOf<SettingsUIData["mcpEnabled"]>().toEqualTypeOf<
        SettingsStateResponse["mcpEnabled"]
      >();
    });
  });

  describe("adapter round-trip", () => {
    it("maps every required SettingsStateResponse field into SettingsUIData", () => {
      const ui = mapWgwSettingsStateToUI(settingsStateFixture);

      assertFieldMappings([
        { path: "user.username", api: settingsStateFixture.user.username, ui: ui.user.username },
        {
          path: "user.displayName",
          api: settingsStateFixture.user.displayName,
          ui: ui.user.displayName,
        },
        { path: "user.email", api: settingsStateFixture.user.email, ui: ui.user.email },
        { path: "groups", api: settingsStateFixture.groups, ui: ui.groups },
        { path: "logoutUrl", api: settingsStateFixture.logoutUrl, ui: ui.logoutUrl },
        { path: "mcpEnabled", api: settingsStateFixture.mcpEnabled, ui: ui.mcpEnabled },
      ]);
    });

    it("preserves group order from the API payload", () => {
      const ui = mapWgwSettingsStateToUI(settingsStateFixture);
      expect(ui.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });
  });
});
