import type { AdminUpdateState } from "@/admin-core/src/admin-types";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";

/** Matches CalendarImipService::HOURLY_LIMIT_DEFAULT. The server applies the same fallback. */
export const IMIP_HOURLY_LIMIT_DEFAULT = 100;

/** Matches CalendarImipService::DAILY_LIMIT_DEFAULT. The server applies the same fallback. */
export const IMIP_DAILY_LIMIT_DEFAULT = 300;

/** Older settings may separate urls with commas, newlines, or both. */
export function splitIceUrlRows(value: string): string[] {
  if (value.trim() === "") return [];
  return value.split(/[\n\r,]/).map((row) => row.trim());
}

export function normalizeImipDailyLimit(raw: string): number {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return IMIP_DAILY_LIMIT_DEFAULT;
  }

  return Math.floor(parsed);
}

export function normalizeImipHourlyLimit(raw: string, dailyRaw: string): number {
  const daily = normalizeImipDailyLimit(dailyRaw);
  const parsed = Number(raw.trim());
  const hourly =
    !Number.isFinite(parsed) || parsed < 1 ? IMIP_HOURLY_LIMIT_DEFAULT : Math.floor(parsed);

  return Math.min(hourly, daily);
}

export type AdminSettingsFormState = {
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  stunUrls: string;
  turnUrls: string;
  turnSecret: string;
  turnSecretSet: boolean;
  turnStaticCredentialsPresent: boolean;
  maxVideoProfile: string;
  maxVideoProfileRelay: string;
  rtcDebugLogging: boolean;
  rtcForceRelay: boolean;
  calendars: boolean;
  contacts: boolean;
  imipExternalEnabled: boolean;
  /** Raw hourly-limit field. Normalized in {@link adminSettingsFormToMap}. */
  imipHourlyLimit: string;
  /** Raw daily-limit field. Normalized in {@link adminSettingsFormToMap}. */
  imipDailyLimit: string;
  sabreUi: boolean;
  timezone: string;
  baseUri: string;
  authRealm: string;
  mailDeliveryFrom: string;
  mailDeliveryTransport: string;
  mailDeliverySmtpHost: string;
  mailDeliverySmtpPort: number;
  mailDeliverySmtpSecurity: string;
  mailDeliverySmtpUsername: string;
  mailDeliverySmtpPassword: string;
  mcpEnabled: boolean;
};

/** Keep the progress card visible during POST /apply while merging poll snapshots. */
export function mergePendingApplyPoll(
  prev: AdminUpdateState,
  next: AdminUpdateState,
): AdminUpdateState {
  return {
    ...prev,
    ...next,
    inProgress: true,
    phase: next.phase ?? prev.phase ?? "downloading",
    current: next.current ?? prev.current,
    download: next.download ?? prev.download,
    phaseProgress: next.phaseProgress ?? prev.phaseProgress,
    cancelRequested: next.cancelRequested,
    cancelAllowed: next.cancelAllowed,
  };
}

export function buildAdminSettingsFormState(
  data: AdminWorkspaceProps["data"],
): AdminSettingsFormState {
  const normalizeSecurity = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "ssl" || normalized === "ssl/tls") return "ssl";
    if (normalized === "starttls") return "starttls";
    return "none";
  };
  return {
    imapHost: data.mail.imapHost,
    imapPort: data.mail.imapPort,
    imapSecurity: normalizeSecurity(data.mail.imapSecurity),
    smtpHost: data.mail.smtpHost,
    smtpPort: data.mail.smtpPort,
    smtpSecurity: normalizeSecurity(data.mail.smtpSecurity),
    stunUrls: data.rtc.stunUrls,
    turnUrls: data.rtc.turnUrls,
    turnSecret: "",
    turnSecretSet: data.rtc.turnSecretSet,
    turnStaticCredentialsPresent: data.rtc.turnStaticCredentialsPresent,
    maxVideoProfile: data.rtc.maxVideoProfile,
    maxVideoProfileRelay: data.rtc.maxVideoProfileRelay,
    rtcDebugLogging: data.rtc.debugLogging,
    rtcForceRelay: data.rtc.forceRelay,
    calendars: data.apps.calendars,
    contacts: data.apps.contacts,
    imipExternalEnabled: data.apps.imipExternalEnabled,
    imipHourlyLimit: String(data.apps.imipHourlyLimit),
    imipDailyLimit: String(data.apps.imipDailyLimit),
    sabreUi: data.webdav.sabreUi,
    timezone: data.webdav.timezone,
    baseUri: data.webdav.baseUri,
    authRealm: data.webdav.authRealm,
    mailDeliveryFrom: data.mailDelivery.config.from,
    mailDeliveryTransport: data.mailDelivery.config.transport,
    mailDeliverySmtpHost: data.mailDelivery.config.smtpHost || data.mail.smtpHost,
    mailDeliverySmtpPort: data.mailDelivery.config.smtpHost
      ? data.mailDelivery.config.smtpPort
      : data.mail.smtpPort,
    mailDeliverySmtpSecurity: normalizeSecurity(
      data.mailDelivery.config.smtpHost
        ? data.mailDelivery.config.smtpSecurity
        : data.mail.smtpSecurity,
    ),
    mailDeliverySmtpUsername: data.mailDelivery.config.smtpUsername,
    mailDeliverySmtpPassword: "",
    mcpEnabled: data.mcp.enabled,
  };
}

export function adminSettingsFormToMap(
  state: AdminSettingsFormState,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {
    mail_imap_host: state.imapHost,
    mail_imap_port: state.imapPort,
    mail_imap_security: state.imapSecurity,
    mail_smtp_host: state.smtpHost,
    mail_smtp_port: state.smtpPort,
    mail_smtp_security: state.smtpSecurity,
    rtc_stun_url: state.stunUrls,
    rtc_turn_url: state.turnUrls,
    meet_max_video_profile: state.maxVideoProfile,
    meet_max_video_profile_relay: state.maxVideoProfileRelay,
    rtc_debug_logging: state.rtcDebugLogging,
    rtc_force_relay: state.rtcForceRelay,
    calendar_enabled: state.calendars,
    contacts_enabled: state.contacts,
    imip_external_enabled: state.imipExternalEnabled,
    imip_hourly_limit: normalizeImipHourlyLimit(state.imipHourlyLimit, state.imipDailyLimit),
    imip_daily_limit: normalizeImipDailyLimit(state.imipDailyLimit),
    browser_plugin: state.sabreUi,
    timezone: state.timezone,
    base_uri: state.baseUri,
    auth_realm: state.authRealm,
    mail_delivery_from: state.mailDeliveryFrom,
    mail_delivery_transport: state.mailDeliveryTransport,
    mail_delivery_smtp_host: state.mailDeliverySmtpHost,
    mail_delivery_smtp_port: state.mailDeliverySmtpPort,
    mail_delivery_smtp_security: state.mailDeliverySmtpSecurity,
    mail_delivery_smtp_username: state.mailDeliverySmtpUsername,
    mcp_enabled: state.mcpEnabled,
  };
  if (state.mailDeliverySmtpPassword.trim() !== "") {
    values.mail_delivery_smtp_password = state.mailDeliverySmtpPassword;
  }
  // Write-only: an untouched field must not wipe the stored secret.
  if (state.turnSecret.trim() !== "") {
    values.rtc_turn_secret = state.turnSecret.trim();
  }
  return values;
}
