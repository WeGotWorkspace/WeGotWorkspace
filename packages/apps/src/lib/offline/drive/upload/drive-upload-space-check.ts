import { driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import {
  driveQuotaIdForRoot,
  fetchDriveQuotas,
  type DriveQuota,
} from "@/lib/api/wgw/drive-quota-jmap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import type {
  DriveUploadSpaceCheck,
  OfflineDriveUploadItemRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { readDriveUploadQueueRows } from "@/lib/offline/drive/upload/drive-upload-store";
import { resolveDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target";

/** The last `Quota/get` answer, for the pre-check while offline. */
const QUOTAS_META_KEY = "drive:upload-quotas";

const UNKNOWN: DriveUploadSpaceCheck = { status: "unknown" };

/** Quotas as the server last reported them; `fresh` is false for a stored answer. */
export type DriveQuotaReading = { quotas: DriveQuota[]; measuredAt: number; fresh: boolean };

/**
 * The root a cache path belongs to: `users/{name}` or `groups/{slug}`. Null
 * for anything else. Placeholders follow their folder on rename and move, so
 * the root of an item's placeholder path is the root it uploads into.
 */
export function driveUploadRootPath(folderPath: string | undefined): string | null {
  if (!folderPath) return null;
  const [kind, name] = normalizeOfflinePath(folderPath).split("/").filter(Boolean);
  if (!name || (kind !== "users" && kind !== "groups")) return null;
  return `${kind}/${name}`;
}

function parseStored(raw: string | null): Omit<DriveQuotaReading, "fresh"> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveQuotaReading>;
    if (!Array.isArray(parsed.quotas) || typeof parsed.measuredAt !== "number") return null;
    return { quotas: parsed.quotas, measuredAt: parsed.measuredAt };
  } catch {
    return null;
  }
}

/**
 * The account's Drive quotas: fresh from `Quota/get` when online (and stored),
 * else the last stored answer with its age, unless `requireFresh`. Null when
 * the server has no quota support or nothing is known on this device.
 */
export async function readDriveQuotas(
  username: string,
  options: { requireFresh?: boolean } = {},
): Promise<DriveQuotaReading | null> {
  if (readBrowserOnline()) {
    try {
      const quotas = await fetchDriveQuotas(await driveJmapSession());
      if (quotas === null) return null;
      const stored = { quotas, measuredAt: Date.now() };
      await writeMeta(username, QUOTAS_META_KEY, JSON.stringify(stored));
      return { ...stored, fresh: true };
    } catch (error) {
      console.warn("[drive-upload] Quota/get failed", error);
    }
  }
  if (options.requireFresh) return null;
  const stored = parseStored(await readMeta(username, QUOTAS_META_KEY));
  return stored ? { ...stored, fresh: false } : null;
}

/**
 * The quota of the root `rootPath`, picked by the root's FileNode id
 * (`dq-{rootNodeId}`), never by assuming every root has the same free space.
 */
async function quotaForRoot(
  username: string,
  rootPath: string,
  reading: DriveQuotaReading,
): Promise<DriveQuota | null> {
  let rootId: string;
  try {
    rootId = (await resolveDriveUploadTarget(username, rootPath)).id;
  } catch {
    return null;
  }
  return reading.quotas.find((quota) => quota.id === driveQuotaIdForRoot(rootId)) ?? null;
}

/** Bytes still to send for an item; parts already on the server count as sent. */
function remainingBytes(item: Pick<OfflineDriveUploadItemRow, "size" | "bytesDone">): number {
  return Math.max(0, item.size - item.bytesDone);
}

/** Items that will still upload on their own: waiting, uploading, or held by a full server. */
function stillToUpload(item: OfflineDriveUploadItemRow): boolean {
  return item.status !== "failed" || item.error?.code === "server_full";
}

/**
 * The space pre-check of a batch: the batch's size plus what is left in the
 * queue for the same root, against that root's free space. `unknown` when the
 * target root has no quota (or none is known here), so no warning is shown.
 */
export async function checkDriveUploadBatchSpace(
  username: string,
  batchId: string,
): Promise<DriveUploadSpaceCheck> {
  const rows = await readDriveUploadQueueRows(username);
  const rootOf = (item: OfflineDriveUploadItemRow) =>
    driveUploadRootPath(rows.folderPaths?.get(item.id));
  const batchItems = rows.items.filter(
    (item) => item.batchId === batchId && item.status !== "failed",
  );
  const rootPath = batchItems.map(rootOf).find((root) => root !== null) ?? null;
  if (!rootPath) return UNKNOWN;
  const reading = await readDriveQuotas(username);
  if (!reading) return UNKNOWN;
  const quota = await quotaForRoot(username, rootPath, reading);
  if (!quota) return UNKNOWN;

  const batchBytes = batchItems.reduce((sum, item) => sum + item.size, 0);
  const queuedBytes = rows.items
    .filter((item) => item.batchId !== batchId && stillToUpload(item))
    .filter((item) => rootOf(item) === rootPath)
    .reduce((sum, item) => sum + remainingBytes(item), 0);
  const neededBytes = batchBytes + queuedBytes;
  const freeBytes = Math.max(0, quota.hardLimit - quota.used);
  return {
    status: neededBytes <= freeBytes ? "fits" : "does_not_fit",
    quotaId: quota.id,
    batchBytes,
    queuedBytes,
    neededBytes,
    freeBytes,
    measuredAt: reading.measuredAt,
    fresh: reading.fresh,
  };
}

/**
 * Whether a fresh `Quota/get` says the root of `item`'s target folder has room
 * for the rest of it. Used to resume the `paused_server_full` queue; never
 * from a stored answer, and never when the root has no quota.
 */
export async function serverHasSpaceForDriveUpload(
  username: string,
  item: Pick<OfflineDriveUploadItemRow, "size" | "bytesDone">,
  folderPath: string | undefined,
): Promise<boolean> {
  const rootPath = driveUploadRootPath(folderPath);
  if (!rootPath) return false;
  const reading = await readDriveQuotas(username, { requireFresh: true });
  if (!reading) return false;
  const quota = await quotaForRoot(username, rootPath, reading);
  if (!quota) return false;
  return quota.hardLimit - quota.used >= remainingBytes(item);
}
