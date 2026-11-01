import type { DriveUploadCapabilities } from "@/lib/api/wgw/drive-upload-capabilities";

/** Below this, a refused part means the file is too large for this host. */
export const DRIVE_UPLOAD_PART_SIZE_FLOOR = 256 * 1024;

const KEY_PREFIX = "wgw-drive-part-size:";

function key(username: string): string {
  return `${KEY_PREFIX}${username.trim().toLowerCase()}`;
}

/** The part size a host refused down to earlier, for this account; null when none. */
export function readRememberedPartSize(username: string): number | null {
  try {
    const value = Number(globalThis.localStorage?.getItem(key(username)));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

/** Remember a smaller working part size for later files of this account. */
export function rememberPartSize(username: string, partSize: number): void {
  try {
    globalThis.localStorage?.setItem(key(username), String(Math.floor(partSize)));
  } catch {
    // Storage blocked: later files start from the advertised size again.
  }
}

/**
 * The part size a new file starts with: `maxSizeUpload`, capped by the
 * assembly step budget (so one part always fits in one step) and by the size
 * this account was refused down to before. The plain `Blob/upload` fallback
 * has no step budget, so it starts at `maxSizeUpload`.
 */
export function initialPartSize(
  username: string,
  maxSizeUpload: number,
  capabilities: DriveUploadCapabilities,
): number {
  const candidates = [maxSizeUpload];
  if (capabilities.assembly) candidates.push(capabilities.assembly.stepBudgetBytes);
  const remembered = readRememberedPartSize(username);
  if (remembered) candidates.push(remembered);
  return Math.max(1, Math.min(...candidates));
}

/**
 * Half of the part that was refused, never below the floor. Null when the
 * refused part was already at the floor: the file is too large.
 */
export function halvedPartSize(refusedLength: number): number | null {
  if (refusedLength <= DRIVE_UPLOAD_PART_SIZE_FLOOR) return null;
  return Math.max(DRIVE_UPLOAD_PART_SIZE_FLOOR, Math.floor(refusedLength / 2));
}
