import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { CORE_CAPABILITY, FILENODE_CAPABILITY, QUOTA_CAPABILITY } from "@/lib/jmap-client";

/** Prefix of a Drive quota id; the rest is the root's FileNode id (#1500). */
export const DRIVE_QUOTA_ID_PREFIX = "dq-";

/** One RFC 9425 `octets` quota of a writable Drive root. */
export type DriveQuota = { id: string; used: number; hardLimit: number };

export function driveQuotaIdForRoot(rootNodeId: string): string {
  return `${DRIVE_QUOTA_ID_PREFIX}${rootNodeId}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `Quota/get` for the account: one quota per writable root (personal drive
 * and each writable group drive). Null when the Session does not advertise
 * `urn:ietf:params:jmap:quota`. An empty list means the server does not know
 * its free space.
 */
export async function fetchDriveQuotas(
  session: DriveJmapSession,
  signal?: AbortSignal,
): Promise<DriveQuota[] | null> {
  if (!session.quota) return null;
  const response = await session.client.call<{ list?: unknown[] }>(
    "Quota/get",
    { accountId: session.accountId, ids: null },
    // The server only lists Drive quotas when the request uses FileNode (RFC 9425 §4.1).
    { using: [CORE_CAPABILITY, FILENODE_CAPABILITY, QUOTA_CAPABILITY], signal },
  );
  const quotas: DriveQuota[] = [];
  for (const raw of response.list ?? []) {
    const row = raw as Record<string, unknown>;
    const used = finiteNumber(row.used);
    const hardLimit = finiteNumber(row.hardLimit);
    if (typeof row.id !== "string" || used === null || hardLimit === null) continue;
    if (row.resourceType !== undefined && row.resourceType !== "octets") continue;
    quotas.push({ id: row.id, used, hardLimit });
  }
  return quotas;
}
