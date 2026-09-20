import { describe, expect, it } from "vitest";

import {
  buildInstallerDatabasePayload,
  buildInstallerInstallPayload,
  buildInstallerSitePayload,
  installerBlockingChecks,
  installerDefaultEngine,
  installerScreenFromState,
  installerHasDatabaseFromEnv,
  isUsernameTakenError,
  formatInstallerDatabaseError,
} from "@/installer-core/src/installer-flow";
import type { WgwInstallerRuntimeState } from "@/installer-core/src/installer-types";

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

describe("installer-flow", () => {
  it("skips the database screen when env already supplied a database", () => {
    const envState = state({
      step: "database",
      db_from_env: true,
    });
    expect(installerHasDatabaseFromEnv(envState)).toBe(true);
    expect(installerScreenFromState(envState)).toBe("account");
  });

  it("defaults the database UI to MySQL unless env locked SQLite", () => {
    expect(installerDefaultEngine(state())).toBe("mysql");
    expect(installerDefaultEngine(state({ db_driver: "sqlite", db_from_env: true }))).toBe(
      "sqlite",
    );
  });

  it("maps installed or done backend steps to Ready", () => {
    expect(installerScreenFromState(state({ already_installed: true }))).toBe("ready");
    expect(installerScreenFromState(state({ step: "done" }))).toBe("ready");
  });

  it("builds site + install payloads without Mail or DAV toggles", () => {
    const site = buildInstallerSitePayload(state());
    expect(site.enable_files).toBe(true);
    expect(site.enable_calendars).toBe(true);
    expect(site.enable_contacts).toBe(true);

    const install = buildInstallerInstallPayload("jane", "hunter2hunter", " jane@example.test ");
    expect(install.username).toBe("jane");
    expect(install.display_name).toBe("jane");
    expect(install.email).toBe("jane@example.test");
    expect(install.mail_enabled).toBe(false);
    expect(install.meet_enabled).toBe(true);
    expect(install.rtc_stun_url.length).toBeGreaterThan(0);
  });

  it("builds a MySQL database payload from the form", () => {
    const payload = buildInstallerDatabasePayload("mysql", state(), {
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

  it("turns a raw MySQL connection failure into a short line", () => {
    expect(
      formatInstallerDatabaseError(
        "Could not connect to the database: SQLSTATE[HY000] [2002] Connection refused (Connection: wgw, Host: 127.0.0.1, Port: 3306, Database: wgw, SQL: SELECT 1 AS ok)",
      ),
    ).toBe("Could not reach MySQL at 127.0.0.1:3306. Check the host and port, or use SQLite.");
    expect(formatInstallerDatabaseError("SQLSTATE[HY000] [1045] Access denied for user")).toBe(
      "MySQL rejected that username or password.",
    );
  });

  it("hides optional IMAP failures from the interrupt list", () => {
    const blocking = installerBlockingChecks(
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
