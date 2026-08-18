import type { AdminUpdateState } from "@/admin-core/src/admin-types";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";

export type AdminSettingsFormState = {
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  stunUrls: string;
  turnUrls: string;
  turnUsername: string;
  turnPassword: string;
  calendars: boolean;
  contacts: boolean;
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
    turnUsername: data.rtc.turnUsername,
    turnPassword: data.rtc.turnPassword,
    calendars: data.apps.calendars,
    contacts: data.apps.contacts,
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
    rtc_turn_username: state.turnUsername,
    rtc_turn_credential: state.turnPassword,
    calendar_enabled: state.calendars,
    contacts_enabled: state.contacts,
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
  };
  if (state.mailDeliverySmtpPassword.trim() !== "") {
    values.mail_delivery_smtp_password = state.mailDeliverySmtpPassword;
  }
  return values;
}
