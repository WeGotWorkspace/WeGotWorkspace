import {
  BLOB_ASSEMBLY_CAPABILITY,
  BLOB_CAPABILITY,
  FILENODE_VERSION_CHECK_CAPABILITY,
  type JmapSession,
} from "@/lib/jmap-client";

/** RFC 9404 account capability, the parts the uploader reads. */
export type DriveBlobCapability = {
  /** Most data sources one Blob/upload creation may join. */
  maxDataSources: number;
  /** Largest blob Blob/upload may create; null = no limit. */
  maxSizeBlobSet: number | null;
};

/** Blob assembly extension account capability (#1500). */
export type DriveBlobAssemblyCapability = {
  /** Octets one append or finish call may process. */
  stepBudgetBytes: number;
  /** Largest assembly; null = no limit. */
  maxSizeAssembly: number | null;
  assemblyTtlSeconds: number;
};

/** What the Session says about chunked uploads and the version check. */
export type DriveUploadCapabilities = {
  blob: DriveBlobCapability | null;
  assembly: DriveBlobAssemblyCapability | null;
  /** `https://wegotworkspace.org/jmap/filenode-version-check` is advertised. */
  versionCheck: boolean;
};

export const NO_DRIVE_UPLOAD_CAPABILITIES: DriveUploadCapabilities = {
  blob: null,
  assembly: null,
  versionCheck: false,
};

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function accountCapability(
  session: JmapSession,
  accountId: string,
  capability: string,
): Record<string, unknown> | null {
  if (!(capability in session.capabilities)) return null;
  const value = session.accounts[accountId]?.accountCapabilities?.[capability];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Reads the blob, blob assembly, and version check capabilities for one account. */
export function readDriveUploadCapabilities(
  session: JmapSession,
  accountId: string,
): DriveUploadCapabilities {
  const blob = accountCapability(session, accountId, BLOB_CAPABILITY);
  const assembly = accountCapability(session, accountId, BLOB_ASSEMBLY_CAPABILITY);
  const stepBudgetBytes = positiveInt(assembly?.stepBudgetBytes);
  return {
    blob: blob
      ? {
          // RFC 9404 sets the floor of maxDataSources at 64.
          maxDataSources: positiveInt(blob.maxDataSources) ?? 64,
          maxSizeBlobSet: positiveInt(blob.maxSizeBlobSet),
        }
      : null,
    assembly:
      assembly && stepBudgetBytes
        ? {
            stepBudgetBytes,
            maxSizeAssembly: positiveInt(assembly.maxSizeAssembly),
            assemblyTtlSeconds: positiveInt(assembly.assemblyTtlSeconds) ?? 3600,
          }
        : null,
    versionCheck: FILENODE_VERSION_CHECK_CAPABILITY in session.capabilities,
  };
}

const LAST_KNOWN_KEY_PREFIX = "wgw-drive-session-caps:";

/** What the last Session this device saw said, for offline decisions. */
export type LastKnownDriveSession = { versionCheck: boolean; seenAt: number };

function lastKnownKey(username: string): string {
  return `${LAST_KNOWN_KEY_PREFIX}${username.trim().toLowerCase()}`;
}

/** Remember the Session's version check for offline use. Storage errors are ignored. */
export function rememberDriveSessionCapabilities(
  username: string,
  capabilities: Pick<DriveUploadCapabilities, "versionCheck">,
): void {
  const value: LastKnownDriveSession = {
    versionCheck: capabilities.versionCheck,
    seenAt: Date.now(),
  };
  try {
    globalThis.localStorage?.setItem(lastKnownKey(username), JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: offline then counts as "no known Session".
  }
}

/** The last Session this device saw for the account, or null when none is known. */
export function readLastKnownDriveSession(username: string): LastKnownDriveSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(lastKnownKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastKnownDriveSession>;
    if (typeof parsed.versionCheck !== "boolean") return null;
    return { versionCheck: parsed.versionCheck, seenAt: Number(parsed.seenAt) || 0 };
  } catch {
    return null;
  }
}
