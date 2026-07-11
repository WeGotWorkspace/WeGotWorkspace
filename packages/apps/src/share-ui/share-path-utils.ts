import type {
  DriveShare,
  DriveShareAtPath,
  DriveSharePublicSummary,
} from "@wgw-api-generated/drive-types";

export function findShareRecord(atPath: DriveShareAtPath, shareId: string): DriveShare | undefined {
  for (const list of [atPath.directShares, atPath.coveringShares, atPath.nestedShares]) {
    const hit = list.find((entry) => entry.share.id === shareId);
    if (hit) return hit.share;
  }
  return undefined;
}

export function findDirectMemberShare(atPath: DriveShareAtPath): DriveShare | undefined {
  return atPath.directShares.find(
    (entry) => entry.relationship === "direct" && entry.share.kind === "member",
  )?.share;
}

export function findDirectPublicShare(
  atPath: DriveShareAtPath,
): DriveSharePublicSummary | undefined {
  return atPath.publicShares.find((entry) => !entry.inherited && entry.sharePath === atPath.path);
}

export function buildPublicShareUrl(token: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/share/${token}`;
  }
  return `/share/${token}`;
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
