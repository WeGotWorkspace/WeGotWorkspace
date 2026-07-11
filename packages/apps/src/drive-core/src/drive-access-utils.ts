import type {
  DriveShareAccess,
  DriveShareAtPath,
  DriveShareGrantSourceEntry,
  DriveSharePublicSummary,
} from "@wgw-api-generated/drive-types";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";

export type DriveAccessFilter = "all" | "external" | "public" | "groups";

export type DriveAccessDisplayRow =
  | { kind: "grant"; entry: DriveShareGrantSourceEntry }
  | { kind: "public"; entry: DriveSharePublicSummary };

const ACCESS_LABELS: Record<DriveShareAccess, string> = {
  view: "Can view",
  comment: "Can comment",
  review: "Can suggest",
  edit: "Can edit",
  full: "Full access",
};

export function driveAccessLabel(access: DriveShareAccess): string {
  return ACCESS_LABELS[access] ?? access;
}

export function driveAccessPrincipalLabel(principal: string, principalType: string): string {
  if (principalType === "group" && principal.startsWith("groups/")) {
    const slug = principal.slice("groups/".length);
    return slug
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (principalType === "email") return principal;
  return principal;
}

export function driveAccessSubtreeCounts(atPath: DriveShareAtPath | null) {
  if (!atPath) {
    return { external: 0, public: 0, groups: 0, total: 0 };
  }
  const external = atPath.grantSources.filter((row) => row.principalType === "email").length;
  const groups = atPath.grantSources.filter((row) => row.principalType === "group").length;
  const publicCount = atPath.publicShares.length;
  return {
    external,
    public: publicCount,
    groups,
    total: atPath.grantSources.length + publicCount,
  };
}

export function driveAccessSubtitle(counts: ReturnType<typeof driveAccessSubtreeCounts>): string {
  const parts: string[] = [];
  if (counts.external > 0) {
    parts.push(`${counts.external} external`);
  }
  if (counts.public > 0) {
    parts.push(`${counts.public} public ${counts.public === 1 ? "link" : "links"}`);
  }
  if (parts.length === 0) {
    return "Audit who can see what in your drives";
  }
  return parts.join(" · ");
}

function matchesQuery(row: DriveAccessDisplayRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (row.kind === "public") {
    return (
      "public link".includes(normalized) || row.entry.sharePath.toLowerCase().includes(normalized)
    );
  }
  const label = driveAccessPrincipalLabel(
    row.entry.principal,
    row.entry.principalType,
  ).toLowerCase();
  return (
    label.includes(normalized) ||
    row.entry.principal.toLowerCase().includes(normalized) ||
    row.entry.source.sharePath.toLowerCase().includes(normalized)
  );
}

function matchesFilter(row: DriveAccessDisplayRow, filter: DriveAccessFilter): boolean {
  if (filter === "all") return true;
  if (row.kind === "public") return filter === "public";
  if (filter === "public") return false;
  if (filter === "external") return row.entry.principalType === "email";
  if (filter === "groups") return row.entry.principalType === "group";
  return true;
}

export function driveAccessDisplayRows(
  atPath: DriveShareAtPath | null,
  filter: DriveAccessFilter,
  query: string,
): DriveAccessDisplayRow[] {
  if (!atPath) return [];
  const grantRows: DriveAccessDisplayRow[] = atPath.grantSources.map((entry) => ({
    kind: "grant",
    entry,
  }));
  const publicRows: DriveAccessDisplayRow[] = atPath.publicShares.map((entry) => ({
    kind: "public",
    entry,
  }));
  const combined = filter === "public" ? publicRows : [...grantRows, ...publicRows];
  return combined.filter((row) => matchesFilter(row, filter) && matchesQuery(row, query));
}

export function driveAccessViaUiPath(sharePath: string, username: string): string {
  return uiPathFromApiPath(sharePath, username);
}

export function driveAccessIsPersonPrincipal(principalType: string): boolean {
  return principalType === "user";
}
