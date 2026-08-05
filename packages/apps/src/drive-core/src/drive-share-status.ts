import type { DriveShareAtPath } from "@wgw-api-generated/drive-types";

/** True when the path has direct outgoing grants (member, guest, or public), not inherited-only access. */
export function driveItemHasShareGrants(atPath: DriveShareAtPath | null | undefined): boolean {
  if (!atPath) return false;

  if (atPath.publicShares.some((entry) => entry.status === "active" && entry.inherited === false)) {
    return true;
  }

  if (atPath.directShares.some((entry) => entry.status === "active")) {
    return true;
  }

  return atPath.grantSources.some(
    (grant) =>
      grant.source.inherited === false && (grant.status === "active" || grant.status === "pending"),
  );
}
