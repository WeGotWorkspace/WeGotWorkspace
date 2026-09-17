import { wgwApiBaseUrl, wgwReadJson } from "@/lib/api/wgw/http";
import type {
  WgwInstallerActionResponse,
  WgwInstallerBootstrapResponse,
  WgwInstallerDbDriver,
  WgwInstallerStateResponse,
} from "@/lib/api/wgw/types";

type RequestOptions = { signal?: AbortSignal };

export type InstallerRequirementsPayload = {
  db_driver: WgwInstallerDbDriver;
};

export type InstallerDatabasePayload = {
  db_driver: WgwInstallerDbDriver;
  sqlite_path: string;
  mysql_host: string;
  mysql_port: number;
  mysql_db: string;
  mysql_user: string;
  mysql_password: string;
};

export type InstallerSitePayload = {
  base_uri_override: string;
  timezone: string;
  enable_files: boolean;
  enable_calendars: boolean;
  enable_contacts: boolean;
  show_browser_ui: boolean;
};

export type InstallerInstallPayload = {
  username: string;
  display_name: string;
  email: string;
  password: string;
  password_confirm: string;
  mail_enabled: boolean;
  mail_imap_host: string;
  mail_imap_port: string;
  mail_imap_security: string;
  mail_imap_username: string;
  mail_imap_password: string;
  mail_smtp_host: string;
  mail_smtp_port: string;
  mail_smtp_security: string;
  mail_smtp_username: string;
  mail_smtp_password: string;
  meet_enabled: boolean;
  rtc_stun_url: string;
  rtc_turn_url: string;
  rtc_turn_username: string;
  rtc_turn_credential: string;
};

function installerApiBaseUrl(): string {
  return `${wgwApiBaseUrl()}/installer`.replace(/\/+$/, "");
}

async function installerRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = `${installerApiBaseUrl()}${path}`;
  return fetch(url, {
    cache: "no-store",
    ...init,
  });
}

async function readInstallerError(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await wgwReadJson(res)) as { error?: string; message?: string };
    const detail = payload.error ?? payload.message;
    if (typeof detail === "string" && detail.trim() !== "") {
      return detail;
    }
  } catch {
    // Fall through to plain-text parsing below.
  }
  try {
    const text = await res.text();
    if (text.trim() !== "") return text.trim();
  } catch {
    // Ignore secondary parse errors.
  }
  return fallback;
}

async function requestInstallerAction(
  action:
    | "welcome_next"
    | "requirements_check"
    | "requirements_next"
    | "database_test"
    | "database_next"
    | "site_next"
    | "install",
  payload: object,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  const res = await installerRequest("/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new Error(await readInstallerError(res, `POST /installer/action failed (${res.status})`));
  }
  return (await wgwReadJson(res)) as WgwInstallerActionResponse;
}

export async function fetchInstallerState(
  opts?: RequestOptions,
): Promise<WgwInstallerStateResponse> {
  const res = await installerRequest("/state", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /installer/state failed (${res.status})`);
  return (await wgwReadJson(res)) as WgwInstallerStateResponse;
}

export async function fetchInstallerBootstrap(
  opts?: RequestOptions,
): Promise<WgwInstallerBootstrapResponse> {
  const res = await installerRequest("/bootstrap", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /installer/bootstrap failed (${res.status})`);
  return (await wgwReadJson(res)) as WgwInstallerBootstrapResponse;
}

export async function installerWelcomeNext(
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("welcome_next", {}, opts);
}

export async function installerRequirementsCheck(
  payload: InstallerRequirementsPayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("requirements_check", payload, opts);
}

export async function installerRequirementsNext(
  payload: InstallerRequirementsPayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("requirements_next", payload, opts);
}

export async function installerDatabaseTest(
  payload: InstallerDatabasePayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("database_test", payload, opts);
}

export async function installerDatabaseNext(
  payload: InstallerDatabasePayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("database_next", payload, opts);
}

export async function installerSiteNext(
  payload: InstallerSitePayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("site_next", payload, opts);
}

export async function installerInstall(
  payload: InstallerInstallPayload,
  opts?: RequestOptions,
): Promise<WgwInstallerActionResponse> {
  return requestInstallerAction("install", payload, opts);
}
