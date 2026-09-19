import type {
  InstallerDatabasePayload,
  InstallerInstallPayload,
  InstallerSitePayload,
  InstallServerCheck,
  WgwInstallerRuntimeState,
} from "@/install-core/src/install-types";
import { toInstallServerChecks } from "@/install-core/src/install-models";
import { DEFAULT_PUBLIC_STUN_URLS_CSV } from "@/lib/rtc/default-stun";

export type InstallFirstRunScreen = "welcome" | "database" | "account" | "ready" | "interrupt";

const DEFAULT_SQLITE_PATH = "wgw-content/db.sqlite";

export function installerHasDatabaseFromEnv(state: WgwInstallerRuntimeState | null): boolean {
  if (!state) return false;
  return Boolean((state as { db_from_env?: boolean }).db_from_env);
}

export function firstRunBlockingChecks(
  state: WgwInstallerRuntimeState | null,
): InstallServerCheck[] {
  return toInstallServerChecks(state).filter((check) => check.status === "error");
}

export function firstRunScreenFromState(
  state: WgwInstallerRuntimeState | null,
): InstallFirstRunScreen {
  if (!state) return "welcome";
  if (state.already_installed || state.step === "done" || state.step === "installed") {
    return "ready";
  }
  if (state.step === "account" || state.step === "site") {
    return "account";
  }
  if (state.step === "database") {
    return installerHasDatabaseFromEnv(state) ? "account" : "database";
  }
  if (state.step === "requirements" && firstRunBlockingChecks(state).length > 0) {
    return "interrupt";
  }
  return "welcome";
}

export function firstRunDefaultEngine(state: WgwInstallerRuntimeState | null): "sqlite" | "mysql" {
  if (installerHasDatabaseFromEnv(state) && state?.db_driver === "sqlite") {
    return "sqlite";
  }
  return "mysql";
}

export function buildFirstRunSitePayload(
  state: WgwInstallerRuntimeState | null,
): InstallerSitePayload {
  const base = state?.base_uri ?? "/";
  return {
    base_uri_override: base === "/" ? "" : base.replace(/^\/+|\/+$/g, ""),
    timezone: state?.timezone ?? "UTC",
    enable_files: true,
    enable_calendars: true,
    enable_contacts: true,
    show_browser_ui: true,
  };
}

export function buildFirstRunInstallPayload(
  username: string,
  password: string,
  email: string,
): InstallerInstallPayload {
  return {
    username,
    display_name: username,
    email: email.trim(),
    password,
    password_confirm: password,
    mail_enabled: false,
    mail_imap_host: "",
    mail_imap_port: "993",
    mail_imap_security: "ssl",
    mail_smtp_host: "",
    mail_smtp_port: "587",
    mail_smtp_security: "starttls",
    meet_enabled: true,
    rtc_stun_url: DEFAULT_PUBLIC_STUN_URLS_CSV,
    rtc_turn_url: "",
    rtc_turn_username: "",
    rtc_turn_credential: "",
  };
}

export function buildFirstRunDatabasePayload(
  engine: "sqlite" | "mysql",
  state: WgwInstallerRuntimeState | null,
  mysql?: {
    host: string;
    port: string;
    database: string;
    username: string;
    password: string;
  },
): InstallerDatabasePayload {
  return {
    db_driver: engine,
    sqlite_path: state?.db.sqlite_path ?? DEFAULT_SQLITE_PATH,
    mysql_host: mysql?.host ?? state?.db.mysql_host ?? "127.0.0.1",
    mysql_port: Number(mysql?.port || state?.db.mysql_port || 3306),
    mysql_db: mysql?.database ?? state?.db.mysql_db ?? "wgw",
    mysql_user: mysql?.username ?? state?.db.mysql_user ?? "wgw",
    mysql_password: mysql?.password ?? "",
  };
}

export function isUsernameTakenError(message: string): boolean {
  return /taken|already exists/i.test(message);
}
