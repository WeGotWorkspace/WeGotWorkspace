import { defaultMailDeliveryState } from "@/admin-core/src/admin-mail-delivery";
import type { AdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import type {
  WgwAdminStateResponse,
  WgwPluginDescriptor,
  WgwPluginsResponse,
  WgwAdminSettingsSaveRequest,
  WgwSearchReindexStateResponse,
  WgwUpdateLogResponse,
  WgwUpdateStateResponse,
} from "@/lib/api/wgw/types";
import type {
  AdminAPIOperations,
  AdminSearchReindexState,
  AdminUIData,
  AdminUpdateBackupItem,
  AdminUpdateCheck,
  AdminUpdateState,
} from "@/admin-core/src/admin-types";

function coerceUpdateBackupItem(input: AdminUpdateBackupItem): AdminUpdateBackupItem {
  return {
    name: input.name,
    sizeBytes: input.sizeBytes,
    modifiedAt: input.modifiedAt ?? null,
    fromVersion: input.fromVersion ?? null,
    toVersion: input.toVersion ?? null,
    format: input.format,
    downloadable: input.downloadable,
  };
}

function coerceUpdateCheck(input: AdminUpdateCheck): AdminUpdateCheck {
  return {
    ok: input.ok,
    label: input.label,
    detail: input.detail,
    status: input.status,
  };
}

export function mapWgwUpdateStateToUI(state: WgwUpdateStateResponse): AdminUpdateState {
  return {
    installChannel: state.installChannel ?? null,
    installedVersion: state.installedVersion,
    schemaVersion: state.schemaVersion,
    latest: state.latest
      ? {
          version: state.latest.version,
          package_url: state.latest.package_url,
          checksum_sha256: state.latest.checksum_sha256,
          checksum_signature: state.latest.checksum_signature,
        }
      : null,
    updateAvailable: state.updateAvailable,
    compatible: state.compatible,
    backups: state.backups.map((item) => coerceUpdateBackupItem(item)),
    checks: state.checks.map((check) => coerceUpdateCheck(check)),
    inProgress: state.inProgress,
    phase: state.phase ?? null,
    current: state.current
      ? { from: state.current.from, to: state.current.to, at: state.current.at }
      : null,
    download: state.download
      ? {
          downloadedBytes: state.download.downloadedBytes,
          totalBytes: state.download.totalBytes ?? null,
          percent: state.download.percent ?? null,
          updatedAt: state.download.updatedAt,
        }
      : null,
    phaseProgress: state.phaseProgress
      ? {
          completed: state.phaseProgress.completed,
          total: state.phaseProgress.total,
          percent: state.phaseProgress.percent,
          updatedAt: state.phaseProgress.updatedAt,
        }
      : null,
    cancelRequested: state.cancelRequested,
    cancelAllowed: state.cancelAllowed,
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastCheckError: state.lastCheckError ?? null,
    lastResult: state.lastResult
      ? {
          ok: state.lastResult.ok,
          version: state.lastResult.version,
          message: state.lastResult.message,
          finishedAt: state.lastResult.finishedAt ?? null,
        }
      : null,
  };
}

export function mapWgwSearchReindexStateToUI(
  state: WgwSearchReindexStateResponse,
): AdminSearchReindexState {
  return {
    inProgress: state.inProgress,
    phase: state.phase ?? null,
    phaseProgress: state.phaseProgress
      ? {
          completed: state.phaseProgress.completed,
          total: state.phaseProgress.total,
          percent: state.phaseProgress.percent,
          updatedAt: state.phaseProgress.updatedAt,
        }
      : null,
    cancelRequested: state.cancelRequested,
    lastResult: state.lastResult
      ? {
          ok: state.lastResult.ok,
          message: state.lastResult.message,
          finishedAt: state.lastResult.finishedAt ?? null,
        }
      : null,
    logLines: Array.isArray(state.logLines) ? state.logLines : [],
  };
}

export function mapWgwAdminStateToUI(
  state: WgwAdminStateResponse,
  plugins: WgwPluginDescriptor[],
  updateLogLines: string[],
  searchReindex: AdminSearchReindexState,
): AdminUIData {
  return {
    users: state.users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      groups: user.groups,
      createdAt: user.createdAt,
    })),
    groups: state.groups.map((group) => ({
      id: group.id,
      name: group.name,
      displayName: group.displayName,
    })),
    mail: {
      imapHost: state.mail.imapHost,
      imapPort: state.mail.imapPort,
      imapSecurity: state.mail.imapSecurity,
      smtpHost: state.mail.smtpHost,
      smtpPort: state.mail.smtpPort,
      smtpSecurity: state.mail.smtpSecurity,
    },
    mailDelivery: state.mailDelivery ?? defaultMailDeliveryState(),
    rtc: {
      stunUrls: state.rtc.stunUrls,
      turnUrls: state.rtc.turnUrls,
      turnUsername: state.rtc.turnUsername,
      turnPassword: state.rtc.turnPassword,
    },
    apps: {
      calendars: state.apps.calendars,
      contacts: state.apps.contacts,
    },
    webdav: {
      sabreUi: state.webdav.sabreUi,
      timezone: state.webdav.timezone,
      baseUri: state.webdav.baseUri,
      authRealm: state.webdav.authRealm,
    },
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      active: plugin.active,
      source: plugin.source,
    })),
    updates: mapWgwUpdateStateToUI(state.updates),
    searchReindex,
    currentUser: state.currentUser,
    logoutUrl: state.logoutUrl,
    updateLogLines,
  };
}

async function fetchPlugins(opts?: { signal?: AbortSignal }): Promise<WgwPluginDescriptor[]> {
  const res = await wgwFetch("/plugins", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /plugins failed (${res.status})`);
  const payload = (await wgwReadJson(res)) as WgwPluginsResponse;
  return Array.isArray(payload.plugins) ? payload.plugins : [];
}

async function fetchAdminState(opts?: { signal?: AbortSignal }): Promise<WgwAdminStateResponse> {
  const res = await wgwFetch("/admin/state", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /admin/state failed (${res.status})`);
  return (await wgwReadJson(res)) as WgwAdminStateResponse;
}

export async function fetchAdminUpdateLog(opts?: { signal?: AbortSignal }): Promise<string[]> {
  const res = await wgwFetch("/admin/updates/log", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /admin/updates/log failed (${res.status})`);
  const payload = (await wgwReadJson(res)) as WgwUpdateLogResponse;
  return payload.lines;
}

async function fetchAdminUpdateState(opts?: { signal?: AbortSignal }): Promise<AdminUpdateState> {
  const res = await wgwFetch("/admin/updates/state", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /admin/updates/state failed (${res.status})`);
  return mapWgwUpdateStateToUI((await wgwReadJson(res)) as WgwUpdateStateResponse);
}

async function fetchAdminSearchReindexState(opts?: {
  signal?: AbortSignal;
}): Promise<AdminSearchReindexState> {
  const res = await wgwFetch("/admin/search/jobs/current", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /admin/search/jobs/current failed (${res.status})`);
  return mapWgwSearchReindexStateToUI((await wgwReadJson(res)) as WgwSearchReindexStateResponse);
}

async function fetchAdminUpdateStateWithWarmup(opts?: {
  signal?: AbortSignal;
}): Promise<AdminUpdateState> {
  let latest = await fetchAdminUpdateState(opts);
  if (latest.inProgress) return latest;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    latest = await fetchAdminUpdateState(opts);
    if (latest.inProgress) return latest;
  }
  return latest;
}

export async function fetchAdminLiveBootstrap(): Promise<AdminAppBootstrap> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const [session, state, plugins, logLines] = await Promise.all([
        wgwFetchPrincipal(),
        fetchAdminState(),
        fetchPlugins().catch(() => []),
        fetchAdminUpdateLog(),
      ]);
      let searchReindex: AdminSearchReindexState = {
        inProgress: false,
        phase: null,
        phaseProgress: null,
        cancelRequested: false,
        lastResult: null,
        logLines: [],
      };
      try {
        searchReindex = await fetchAdminSearchReindexState();
      } catch {
        // Keep admin bootstrap usable if endpoint is unavailable.
      }
      return {
        session,
        data: mapWgwAdminStateToUI(state, plugins, logLines, searchReindex),
      };
    } catch (error) {
      const canRetry =
        error instanceof Error &&
        (error.message.includes("(503)") || error.message.includes("HTTP 503")) &&
        attempt < maxAttempts;
      if (!canRetry) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }

  throw new Error("Could not load admin state.");
}

async function fetchAdminUiData(opts?: { signal?: AbortSignal }): Promise<AdminUIData> {
  const state = await fetchAdminState(opts);
  let plugins: WgwPluginDescriptor[] = [];
  try {
    plugins = await fetchPlugins(opts);
  } catch {
    plugins = [];
  }
  let logLines: string[] = [];
  try {
    logLines = await fetchAdminUpdateLog(opts);
  } catch {
    // Some deployments can disable or protect update logs. Keep admin usable.
    logLines = [];
  }
  let searchReindex: AdminSearchReindexState = {
    inProgress: false,
    phase: null,
    phaseProgress: null,
    cancelRequested: false,
    lastResult: null,
    logLines: [],
  };
  try {
    searchReindex = await fetchAdminSearchReindexState(opts);
  } catch {
    // Keep admin usable when endpoint is unavailable.
  }
  return mapWgwAdminStateToUI(state, plugins, logLines, searchReindex);
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await wgwReadJson(res)) as { error?: string; message?: string };
    const detail = payload.error ?? payload.message;
    if (detail && detail.trim() !== "") {
      return detail;
    }
  } catch {
    try {
      const text = await res.text();
      if (text.trim() !== "") {
        return text.trim();
      }
    } catch {
      // Ignore parse failures and return fallback below.
    }
  }
  return fallback;
}

export function createWgwAdminOperations(): AdminAPIOperations {
  const toGroupSlug = (groupIdOrSlug: string): string =>
    groupIdOrSlug.startsWith("principals/groups/")
      ? groupIdOrSlug.slice("principals/groups/".length)
      : groupIdOrSlug;

  return {
    refreshState: (opts) => fetchAdminUiData(opts),
    saveSettings: async (values, opts) => {
      const payload: WgwAdminSettingsSaveRequest = {
        values,
        ...(opts?.clearSmtpPassword ? { clearSmtpPassword: true } : {}),
      };
      const res = await wgwFetch("/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`PUT /admin/settings failed (${res.status})`);
      return fetchAdminUiData(opts);
    },
    sendMailDeliveryTest: async (opts) => {
      const res = await wgwFetch("/admin/mail-delivery/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts?.to ? { to: opts.to } : {}),
        signal: opts?.signal,
      });
      if (!res.ok) {
        const message = await readApiError(
          res,
          `POST /admin/mail-delivery/test failed (${res.status})`,
        );
        throw new Error(message);
      }
      return fetchAdminUiData(opts);
    },
    checkUpdates: async (opts) => {
      const res = await wgwFetch("/admin/update-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "check" }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`POST /admin/update-jobs failed (${res.status})`);
      return fetchAdminUiData(opts);
    },
    refreshUpdateState: (opts) => fetchAdminUpdateState(opts),
    applyUpdate: async (version, opts) => {
      const res = await wgwFetch("/admin/update-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "apply", version }),
        signal: opts?.signal,
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 503) {
          try {
            const updates = await fetchAdminUpdateStateWithWarmup(opts);
            if (updates.inProgress) {
              return updates;
            }
          } catch {
            // Fall through to detailed error below.
          }
        }
        const message = await readApiError(res, `POST /admin/update-jobs failed (${res.status})`);
        throw new Error(message);
      }
      await wgwReadJson(res as Response);
      return fetchAdminUpdateStateWithWarmup(opts);
    },
    cancelUpdate: async (opts) => {
      const res = await wgwFetch("/admin/update-jobs/current", {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`DELETE /admin/update-jobs/current failed (${res.status})`);
      const payload = (await wgwReadJson(res)) as { state: WgwUpdateStateResponse };
      return mapWgwUpdateStateToUI(payload.state);
    },
    startSearchReindex: async (opts) => {
      const res = await wgwFetch("/admin/search/jobs", { method: "POST", signal: opts?.signal });
      if (!res.ok) {
        const message = await readApiError(res, `POST /admin/search/jobs failed (${res.status})`);
        throw new Error(message);
      }
      await wgwReadJson(res);
      return fetchAdminSearchReindexState(opts);
    },
    refreshSearchReindexState: (opts) => fetchAdminSearchReindexState(opts),
    cancelSearchReindex: async (opts) => {
      const res = await wgwFetch("/admin/search/jobs/current", {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) {
        const message = await readApiError(
          res,
          `DELETE /admin/search/jobs/current failed (${res.status})`,
        );
        throw new Error(message);
      }
      const payload = (await wgwReadJson(res)) as { state: WgwSearchReindexStateResponse };
      return mapWgwSearchReindexStateToUI(payload.state);
    },
    refreshUpdateLog: (opts) => fetchAdminUpdateLog(opts),
    clearUpdateLog: async (opts) => {
      const res = await wgwFetch("/admin/updates/log", { method: "DELETE", signal: opts?.signal });
      if (!res.ok) throw new Error(`DELETE /admin/updates/log failed (${res.status})`);
      await wgwReadJson(res);
      return [];
    },
    deleteBackup: async (name, opts) => {
      const res = await wgwFetch(`/admin/backups/${encodeURIComponent(name)}`, {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`DELETE /admin/backups/${name} failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    createBackup: async (opts) => {
      const res = await wgwFetch("/admin/updates/backups", {
        method: "POST",
        signal: opts?.signal,
      });
      if (res.status === 404) {
        throw new Error("Manual database backup creation is not available on this server yet.");
      }
      if (!res.ok) throw new Error(`POST /admin/updates/backups failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    downloadBackup: async (name, opts) => {
      const res = await wgwFetch(`/admin/backups/${encodeURIComponent(name)}`, {
        method: "GET",
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`GET /admin/backups/${name} failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    createUser: async (input, opts) => {
      const res = await wgwFetch("/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          displayName: input.displayName,
          email: input.email,
          groups: (input.groups ?? []).filter((group) => group.startsWith("principals/groups/")),
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`POST /admin/users failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    updateUser: async (username, input, opts) => {
      const res = await wgwFetch(`/admin/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`PATCH /admin/users/${username} failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    deleteUser: async (username, opts) => {
      const res = await wgwFetch(`/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`DELETE /admin/users/${username} failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    createGroup: async (input, opts) => {
      const res = await wgwFetch("/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          slug: input.name,
          displayName: input.displayName ?? input.name,
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`POST /admin/groups failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    updateGroup: async (groupSlug, input, opts) => {
      const slug = toGroupSlug(groupSlug);
      const res = await wgwFetch(`/admin/groups/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`PATCH /admin/groups/${slug} failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    deleteGroup: async (groupSlug, opts) => {
      const slug = toGroupSlug(groupSlug);
      const res = await wgwFetch(`/admin/groups/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`DELETE /admin/groups/${slug} failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    activatePlugin: async (pluginId, opts) => {
      const res = await wgwFetch(`/plugins/${encodeURIComponent(pluginId)}/activation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`PUT /plugins/${pluginId}/activation failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    deactivatePlugin: async (pluginId, opts) => {
      const res = await wgwFetch(`/plugins/${encodeURIComponent(pluginId)}/activation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`PUT /plugins/${pluginId}/activation failed (${res.status})`);
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
    installPluginZip: async (file, opts) => {
      const form = new FormData();
      form.append("plugin", file);
      const res = await wgwFetch("/admin/plugins", {
        method: "POST",
        body: form,
        signal: opts?.signal,
      });
      if (!res.ok) {
        const message = await readApiError(res, `POST /admin/plugins failed (${res.status})`);
        throw new Error(message);
      }
      await wgwReadJson(res);
      return fetchAdminUiData(opts);
    },
  };
}
