import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { normalizeApiVirtualPath as normalizePath } from "@/lib/files/api-path";
import type {
  DriveShare,
  DriveShareAtPath,
  DriveShareAtPathDataResponse,
  DriveShareByPrincipal,
  DriveShareByPrincipalDataResponse,
  DriveShareCreateRequest,
  DriveShareDataResponse,
  DriveShareInvite,
  DriveShareInviteCreateRequest,
  DriveShareInviteDataResponse,
  DriveSharePrincipalEntry,
  DriveSharePrincipalsResponse,
  DriveShareRevokeAllPublicDataResponse,
  DriveShareRevokeAllPublicResult,
  DriveShareUpdateRequest,
  DriveSharedWithMeDataResponse,
  DriveSharedWithMeEntry,
} from "@wgw-api-generated/drive-types";
import type { DriveShareMutationOpts, DriveShareOperations } from "@/drive-core/src/drive-types";

function pathQuery(path: string): string {
  return `path=${encodeURIComponent(normalizePath(path))}`;
}

async function getShareJson<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await wgwFetch(path, { signal: opts?.signal });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new Error(`GET ${path} failed (${res.status}): ${detail}`);
  }
  return (await wgwReadJson(res)) as T;
}

async function postShareJson<T>(
  path: string,
  body: object,
  opts?: DriveShareMutationOpts,
): Promise<T> {
  const res = await wgwFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new Error(`POST ${path} failed (${res.status}): ${detail}`);
  }
  return (await wgwReadJson(res)) as T;
}

async function patchShareJson(
  shareId: string,
  body: DriveShareUpdateRequest,
  opts?: DriveShareMutationOpts,
): Promise<DriveShare> {
  const path = `/files/shares/${encodeURIComponent(shareId)}`;
  const res = await wgwFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new Error(`PATCH ${path} failed (${res.status}): ${detail}`);
  }
  const payload = (await wgwReadJson(res)) as DriveShareDataResponse;
  return payload.data;
}

async function deleteShareRequest(path: string, opts?: DriveShareMutationOpts): Promise<void> {
  const res = await wgwFetch(path, { method: "DELETE", signal: opts?.signal });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new Error(`DELETE ${path} failed (${res.status}): ${detail}`);
  }
}

export async function fetchDriveShareAtPath(
  path: string,
  opts?: { signal?: AbortSignal },
): Promise<DriveShareAtPath> {
  const payload = await getShareJson<DriveShareAtPathDataResponse>(
    `/files/shares/at-path?${pathQuery(path)}`,
    opts,
  );
  return payload.data;
}

export async function fetchDriveShareByPrincipal(
  principal: string,
  scope?: string,
  opts?: { signal?: AbortSignal },
): Promise<DriveShareByPrincipal> {
  const params = new URLSearchParams();
  params.set("principal", principal.trim());
  if (scope?.trim()) {
    params.set("scope", normalizePath(scope));
  }
  const payload = await getShareJson<DriveShareByPrincipalDataResponse>(
    `/files/shares/by-principal?${params.toString()}`,
    opts,
  );
  return payload.data;
}

export async function searchDriveSharePrincipals(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<DriveSharePrincipalEntry[]> {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) {
    params.set("query", trimmed);
  }
  const suffix = params.toString();
  const payload = await getShareJson<DriveSharePrincipalsResponse>(
    `/files/shares/principals${suffix ? `?${suffix}` : ""}`,
    opts,
  );
  return payload.data;
}

export async function fetchDriveSharedWithMe(opts?: {
  signal?: AbortSignal;
  includeNotes?: boolean;
}): Promise<DriveSharedWithMeEntry[]> {
  const params = new URLSearchParams();
  if (opts?.includeNotes) params.set("includeNotes", "true");
  const suffix = params.toString();
  const payload = await getShareJson<DriveSharedWithMeDataResponse>(
    `/files/shared-with-me${suffix ? `?${suffix}` : ""}`,
    opts,
  );
  return payload.data;
}

export async function createDriveShare(
  body: DriveShareCreateRequest,
  opts?: DriveShareMutationOpts,
): Promise<DriveShare> {
  const payload = await postShareJson<DriveShareDataResponse>("/files/shares", body, opts);
  return payload.data;
}

export async function patchDriveShare(
  shareId: string,
  body: DriveShareUpdateRequest,
  opts?: DriveShareMutationOpts,
): Promise<DriveShare> {
  return patchShareJson(shareId, body, opts);
}

export async function deleteDriveShare(
  shareId: string,
  opts?: DriveShareMutationOpts,
): Promise<void> {
  await deleteShareRequest(`/files/shares/${encodeURIComponent(shareId)}`, opts);
}

export async function createDriveShareInvite(
  shareId: string,
  body: DriveShareInviteCreateRequest,
  opts?: DriveShareMutationOpts,
): Promise<DriveShareInvite> {
  const payload = await postShareJson<DriveShareInviteDataResponse>(
    `/files/shares/${encodeURIComponent(shareId)}/invites`,
    body,
    opts,
  );
  return payload.data;
}

export async function deleteDriveShareInvite(
  shareId: string,
  inviteId: string,
  opts?: DriveShareMutationOpts,
): Promise<void> {
  await deleteShareRequest(
    `/files/shares/${encodeURIComponent(shareId)}/invites/${encodeURIComponent(inviteId)}`,
    opts,
  );
}

export async function revokeAllDrivePublicShares(
  path: string,
  opts?: DriveShareMutationOpts,
): Promise<DriveShareRevokeAllPublicResult> {
  const payload = await postShareJson<DriveShareRevokeAllPublicDataResponse>(
    `/files/shares/public/revoke-all?${pathQuery(path)}`,
    {},
    opts,
  );
  return payload.data;
}

export function createWgwDriveShareOperations(): DriveShareOperations {
  return {
    getAtPath: fetchDriveShareAtPath,
    getByPrincipal: fetchDriveShareByPrincipal,
    searchPrincipals: searchDriveSharePrincipals,
    listSharedWithMe: fetchDriveSharedWithMe,
    createShare: createDriveShare,
    patchShare: patchDriveShare,
    deleteShare: deleteDriveShare,
    createInvite: createDriveShareInvite,
    deleteInvite: deleteDriveShareInvite,
    revokeAllPublic: revokeAllDrivePublicShares,
  };
}
