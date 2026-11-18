import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import { formatRelativeDay } from "@/lib/datetime/format-list-date";
import { displayOriginHost } from "@/settings-core/src/display-origin-host";
import { groupMcpScopeIds, mcpScopeActionLabel } from "@/settings-core/src/mcp-scope-labels";

/**
 * Settings → AI assistants groups grants per product. DCR makes a new OAuth
 * client for every registration, so one product (Claude Code on three
 * machines) arrives as several grants; each grant is one connection.
 */
export type McpAssistantGroup = {
  key: string;
  name: string;
  /** Where the product's connections come from: a host ("claude.ai") or "Local app". */
  source: string;
  connections: SettingsMcpGrant[];
};

export const MCP_LOCAL_APP_SOURCE = "Local app";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Host of the client's origin, or "Local app" when it redirects to this machine (Claude Code, Cursor). */
export function mcpGrantSource(grant: SettingsMcpGrant): string {
  const origin = grant.clientOrigin?.trim() ?? "";
  if (origin === "") return "";
  try {
    if (LOOPBACK_HOSTS.has(new URL(origin).hostname)) return MCP_LOCAL_APP_SOURCE;
  } catch {
    // Not a URL; show what we have.
  }
  return displayOriginHost(origin);
}

function grantName(grant: SettingsMcpGrant): string {
  const name = grant.clientName?.trim() ?? "";
  if (name !== "") return name;
  return mcpGrantSource(grant) || "Assistant";
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Most recent of last use and connect, for ordering. */
export function mcpGrantActivityAt(grant: SettingsMcpGrant): number {
  return Math.max(timestamp(grant.lastUsedAt), timestamp(grant.connectedAt));
}

/**
 * One group per product name and source, most recently active first. The source
 * is part of the key, so a client that calls itself "Claude" from another host
 * never hides among the real Claude's connections.
 */
export function groupMcpGrants(grants: readonly SettingsMcpGrant[]): McpAssistantGroup[] {
  const groups = new Map<string, McpAssistantGroup>();
  const byActivity = [...grants].sort((a, b) => mcpGrantActivityAt(b) - mcpGrantActivityAt(a));
  for (const grant of byActivity) {
    const name = grantName(grant);
    const source = mcpGrantSource(grant);
    const key = `${name.toLowerCase()}\u0000${source.toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.connections.push(grant);
    } else {
      groups.set(key, { key, name, source, connections: [grant] });
    }
  }
  return [...groups.values()];
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\b(Macintosh|Mac OS X)\b/, "Mac"],
  [/\bWindows\b/, "Windows"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(table: [RegExp, string][], value: string): string | null {
  for (const [pattern, label] of table) {
    if (pattern.test(value)) return label;
  }
  return null;
}

/**
 * "Safari on Mac" from the consent browser's user agent. This is where the user
 * approved, not where the assistant runs: cloud connectors call from the
 * vendor's servers. Null when nothing is recognisable.
 */
export function userAgentLabel(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.trim() ?? "";
  if (ua === "") return null;
  const browser = firstMatch(BROWSERS, ua);
  const system = firstMatch(SYSTEMS, ua);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `Browser on ${system}` : null);
}

const OTHER_GROUP = "Other";

const ACTION_ORDER = ["Read", "Write", "Share"];

/** One app the grant reaches and what it may do there, e.g. { app: "Calendar", actions: ["Read", "Write"] }. */
export type McpAppAccess = { app: string; actions: string[] };

/**
 * Access per app, as rows sorted by app name: Read / Write / Share tags. Legacy combined ids
 * ("Read and write") split into their parts; scopes outside the app catalog
 * (retired mail ids) keep their id so an old grant stays recognisable.
 */
export function mcpAppAccess(scopes: readonly string[]): McpAppAccess[] {
  const rows = groupMcpScopeIds([...scopes]).map((group) => {
    if (group.label === OTHER_GROUP) {
      return { app: group.label, actions: group.scopes.map((scope) => scope.id) };
    }
    const actions = new Set<string>();
    for (const scope of group.scopes) {
      for (const part of mcpScopeActionLabel(scope.id).split(/\s+and\s+/i)) {
        actions.add(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
      }
    }
    const ordered = [...actions].sort(
      (a, b) => (ACTION_ORDER.indexOf(a) + 1 || 99) - (ACTION_ORDER.indexOf(b) + 1 || 99),
    );
    return { app: group.label, actions: ordered };
  });
  // The legacy "docs" id also authorizes Notes (read and write).
  if (scopes.includes("docs")) {
    const notes = rows.find((row) => row.app === "Notes");
    if (notes) notes.actions = ["Read", "Write"];
    else rows.push({ app: "Notes", actions: ["Read", "Write"] });
  }
  // Alphabetical, the catch-all Other last.
  return rows.sort((a, b) =>
    a.app === OTHER_GROUP ? 1 : b.app === OTHER_GROUP ? -1 : a.app.localeCompare(b.app),
  );
}

/** True when every connection of the group has the same scopes (then the tags show once). */
export function connectionsShareScopes(connections: readonly SettingsMcpGrant[]): boolean {
  const key = (grant: SettingsMcpGrant) => [...grant.scopes].sort().join(" ");
  return connections.every((grant) => key(grant) === key(connections[0]));
}

function formatDay(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/** "12 min. ago" or "3 hr. ago" today; "yesterday", "3 days ago" before that. */
export function formatActiveAgo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60 || date.toDateString() === now.toDateString()) {
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
    return minutes < 60
      ? format.format(-minutes, "minute")
      : format.format(-Math.round(minutes / 60), "hour");
  }
  return formatRelativeDay(date, now, { capitalised: false });
}

/** ["Safari on Mac", "Approved Nov 12", "Active 12 min. ago"]. */
export function connectionMetaParts(grant: SettingsMcpGrant, now: Date = new Date()): string[] {
  const parts: string[] = [];
  const via = userAgentLabel(grant.approvedUserAgent);
  if (via) parts.push(via);
  parts.push(
    grant.approvedAt
      ? `Approved ${formatDay(grant.approvedAt, now)}`
      : `Connected ${formatDay(grant.connectedAt, now)}`,
  );
  parts.push(
    grant.lastUsedAt ? `Active ${formatActiveAgo(grant.lastUsedAt, now)}` : "Not used yet",
  );
  return parts;
}
