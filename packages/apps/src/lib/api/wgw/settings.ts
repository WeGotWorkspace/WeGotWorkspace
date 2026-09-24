import type {
  SettingsMailRequest,
  SettingsProfileRequest,
} from "@wgw-api-generated/settings-types";
import type { SettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import type {
  WgwSettingsStateResponse,
  WgwSettingsUserGroup,
  WgwSettingsUserMail,
  WgwSettingsUserMailServer,
  WgwSettingsUserProfile,
} from "@/lib/api/wgw/types";
import type { SettingsUIData, SettingsMcpGrant } from "@/settings-core/src/settings-types";

function toUser(raw: WgwSettingsUserProfile): SettingsUIData["user"] {
  return {
    username: raw.username,
    displayName: raw.displayName,
    email: raw.email,
  };
}

function toGroups(raw: WgwSettingsUserGroup[]): SettingsUIData["groups"] {
  return raw.map((group) => ({
    id: group.id,
    displayName: group.displayName,
  }));
}

function toMail(raw: WgwSettingsUserMail): SettingsUIData["mail"] {
  return {
    imapUsername: raw.imapUsername,
    imapHasPassword: raw.imapHasPassword,
  };
}

function toMailServer(raw: WgwSettingsUserMailServer): SettingsUIData["mailServer"] {
  return {
    imapHost: raw.imapHost,
    imapPort: raw.imapPort,
    imapSecurity: raw.imapSecurity,
    smtpHost: raw.smtpHost,
    smtpPort: raw.smtpPort,
    smtpSecurity: raw.smtpSecurity,
  };
}

export function mapWgwSettingsStateToUI(state: WgwSettingsStateResponse): SettingsUIData {
  return {
    user: toUser(state.user),
    groups: toGroups(state.groups),
    mail: toMail(state.mail),
    mailServer: toMailServer(state.mailServer),
    logoutUrl: state.logoutUrl,
    mcpEnabled: state.mcpEnabled === true,
  };
}

export async function fetchSettingsLiveBootstrap(): Promise<SettingsAppBootstrap> {
  const [session, stateRes] = await Promise.all([wgwFetchPrincipal(), wgwFetch("/settings/state")]);
  if (!stateRes.ok) throw new Error(`GET /settings/state failed (${stateRes.status})`);
  const json = (await wgwReadJson(stateRes)) as WgwSettingsStateResponse;
  const data = mapWgwSettingsStateToUI(json);

  return {
    data,
    session: {
      user: {
        displayName: data.user.displayName,
        username: data.user.username,
        email: data.user.email,
        initials: workspaceUserInitials({ displayName: data.user.displayName }),
      },
      viewerInboxLabel: session.viewerInboxLabel,
    },
  };
}

async function requestSettings(
  path: "/settings/profile" | "/settings/mail",
  body: object,
  opts?: { signal?: AbortSignal },
): Promise<WgwSettingsStateResponse> {
  const res = await wgwFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new Error(`PUT ${path} failed (${res.status})`);
  }
  return (await wgwReadJson(res)) as WgwSettingsStateResponse;
}

export async function saveSettingsProfile(
  input: SettingsProfileRequest,
  opts?: { signal?: AbortSignal },
): Promise<SettingsUIData> {
  const state = await requestSettings("/settings/profile", input, opts);
  return mapWgwSettingsStateToUI(state);
}

export async function saveSettingsMail(
  input: SettingsMailRequest,
  opts?: { signal?: AbortSignal },
): Promise<SettingsUIData> {
  const state = await requestSettings("/settings/mail", input, opts);
  return mapWgwSettingsStateToUI(state);
}

export async function listSettingsMcpGrants(opts?: {
  signal?: AbortSignal;
}): Promise<SettingsMcpGrant[]> {
  const res = await wgwFetch("/settings/mcp-grants", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /settings/mcp-grants failed (${res.status})`);
  const payload = (await wgwReadJson(res)) as { grants?: SettingsMcpGrant[] };
  return Array.isArray(payload.grants) ? payload.grants : [];
}

export async function revokeSettingsMcpGrant(
  clientId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const res = await wgwFetch(`/settings/mcp-grants/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`DELETE /settings/mcp-grants/${clientId} failed (${res.status})`);
}
