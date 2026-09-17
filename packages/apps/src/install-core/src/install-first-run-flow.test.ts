import { describe, expect, it } from "vitest";

import {
  buildFirstRunDatabasePayload,
  buildFirstRunInstallPayload,
  buildFirstRunSitePayload,
  firstRunBlockingChecks,
  firstRunDefaultEngine,
  firstRunScreenFromState,
  installerHasDatabaseFromEnv,
  isUsernameTakenError,
} from "@/install-core/src/install-first-run-flow";
import type { WgwInstallerRuntimeState } from "@/install-core/src/install-types";

type RuntimeWithEnv = WgwInstallerRuntimeState & { db_from_env?: boolean };

function state(patch: Partial<RuntimeWithEnv> = {}): RuntimeWithEnv {
  return {
    step: "welcome",
    flash: null,
    already_installed: false,
    db_driver: "mysql",
    db: {},
    enable_files: true,
    enable_contacts: true,
    enable_calendars: true,
    timezone: "UTC",
    base_uri: "/",
    show_browser_ui: true,
    checks: [],
    ...patch,
  };
}

describe("install-first-run-flow", () => {
  it("skips the database screen when env already supplied a database", () => {
    const envState = state({
      step: "database",
      db_from_env: true,
    });
    expect(installerHasDatabaseFromEnv(envState)).toBe(true);
    expect(firstRunScreenFromState(envState)).toBe("account");
  });

  it("defaults the database UI to MySQL unless env locked SQLite", () => {
    expect(firstRunDefaultEngine(state())).toBe("mysql");
    expect(firstRunDefaultEngine(state({ db_driver: "sqlite", db_from_env: true }))).toBe("sqlite");
  });

  it("maps installed or done backend steps to Ready", () => {
    expect(firstRunScreenFromState(state({ already_installed: true }))).toBe("ready");
    expect(firstRunScreenFromState(state({ step: "done" }))).toBe("ready");
  });

  it("builds site + install payloads without Mail or DAV toggles", () => {
    const site = buildFirstRunSitePayload(state());
    expect(site.enable_files).toBe(true);
    expect(site.enable_calendars).toBe(true);
    expect(site.enable_contacts).toBe(true);

    const install = buildFirstRunInstallPayload("jane", "hunter2hunter");
    expect(install.username).toBe("jane");
    expect(install.display_name).toBe("jane");
    expect(install.email).toBe("");
    expect(install.mail_enabled).toBe(false);
    expect(install.meet_enabled).toBe(true);
    expect(install.rtc_stun_url.length).toBeGreaterThan(0);
  });

  it("builds a MySQL database payload from the form", () => {
    const payload = buildFirstRunDatabasePayload("mysql", state(), {
      host: "db",
      port: "3307",
      database: "office",
      username: "wgw",
      password: "secret",
    });
    expect(payload.db_driver).toBe("mysql");
    expect(payload.mysql_host).toBe("db");
    expect(payload.mysql_port).toBe(3307);
    expect(payload.mysql_db).toBe("office");
  });

  it("detects a taken-username error", () => {
    expect(isUsernameTakenError("That username is taken.")).toBe(true);
    expect(isUsernameTakenError("Connection failed.")).toBe(false);
  });

  it("hides optional IMAP failures from the interrupt list", () => {
    const blocking = firstRunBlockingChecks(
      state({
        checks: [
          { ok: false, label: "PHP version", detail: "Too old" },
          {
            ok: false,
            label: "Extension: imap (optional)",
            detail: "Mail app",
            optional: true,
          } as WgwInstallerRuntimeState["checks"][number] & { optional: true },
        ],
      }),
    );
    expect(blocking.map((check) => check.label)).toEqual(["PHP version"]);
  });
});
