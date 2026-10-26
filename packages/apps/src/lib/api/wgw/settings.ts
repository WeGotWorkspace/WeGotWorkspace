import type { SettingsProfileRequest } from "@wgw/openapi-types/settings-types";
import type { SettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import {
  wgwEnsureFreshAccessToken,
  wgwFetch,
  wgwFetchPrincipal,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import type {
  WgwSettingsStateResponse,
  WgwSettingsUserGroup,
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

export function mapWgwSettingsStateToUI(state: WgwSettingsStateResponse): SettingsUIData {
  return {
    user: toUser(state.user),
    groups: toGroups(state.groups),
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
  path: "/settings/profile",
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
  await wgwEnsureFreshAccessToken();
  const state = await requestSettings("/settings/profile", input, opts);
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
