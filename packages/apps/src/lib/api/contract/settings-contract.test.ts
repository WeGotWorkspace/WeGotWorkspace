import { describe, expect, it, expectTypeOf } from "vitest";
import type { SettingsStateResponse } from "@wgw-api-generated/settings-types";
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
  mail: {
    imapUsername: "alice@mail.example.test",
    imapHasPassword: true,
  },
  mailServer: {
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecurity: "starttls",
  },
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

    it("maps SettingsStateResponse mail credentials 1:1 into SettingsUIData.mail", () => {
      type MailFromApi = Pick<SettingsUIData["mail"], keyof SettingsStateResponse["mail"]>;
      expectTypeOf<MailFromApi>().toEqualTypeOf<SettingsStateResponse["mail"]>();
    });

    it("maps SettingsStateResponse mailServer 1:1 into SettingsUIData.mailServer", () => {
      type MailServerFromApi = Pick<
        SettingsUIData["mailServer"],
        keyof SettingsStateResponse["mailServer"]
      >;
      expectTypeOf<MailServerFromApi>().toEqualTypeOf<SettingsStateResponse["mailServer"]>();
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
        {
          path: "mail.imapUsername",
          api: settingsStateFixture.mail.imapUsername,
          ui: ui.mail.imapUsername,
        },
        {
          path: "mail.imapHasPassword",
          api: settingsStateFixture.mail.imapHasPassword,
          ui: ui.mail.imapHasPassword,
        },
        { path: "mailServer", api: settingsStateFixture.mailServer, ui: ui.mailServer },
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
