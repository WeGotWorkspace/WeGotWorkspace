/**
 * UI labels for MCP OAuth scopes. Mirrors `McpScopes` in the API
 * (`consentGroups`, `advertisedDescriptions`, `consentActionLabel`).
 */

import type { WorkspaceAppId } from "@/lib/workspace-app-icons";

export type McpScopeGroup = {
  label: string;
  scopes: { id: string; actionLabel: string }[];
};

export type McpConsentScope = {
  id: string;
  description: string;
};

export type McpConsentGroup = {
  label: string;
  scopes: McpConsentScope[];
};

export const MCP_CONSENT_GROUP_APP_ID: Record<string, WorkspaceAppId | undefined> = {
  Calendar: "calendar",
  Notes: "notes",
  Contacts: "contacts",
  Tasks: "tasks",
  Docs: "docs",
  Drive: "drive",
  Meet: "meet",
  Mail: "mail",
  Profile: "settings",
};

export const MCP_SCOPE_CATALOG: Record<string, string> = {
  "calendar.read": "Read calendars and events",
  "calendar.write": "Create, update, delete, and share calendars and events",
  "notes.read": "Read and search notes and notebooks",
  "notes.write": "Create, update, delete, and share notes and notebooks",
  "contacts.read": "Read and search contacts and address books",
  "contacts.write": "Create, update, delete, and share contacts",
  "tasks.read": "Read tasks and task lists",
  "tasks.write": "Create, update, delete, and share tasks and task lists",
  "docs.read": "Read and search Docs files",
  "docs.write": "Create, update, delete, and share Docs files",
  "drive.read": "Read and search Drive files and folders",
  "drive.write": "Create, update, move, delete, and share Drive files and folders",
  "meet.read": "Read Meet channels and messages",
  "meet.write": "Create, update, and delete Meet channels and messages",
  "mail.read": "Read mailboxes and messages",
  "mail.send": "Send mail as you",
  settings: "Read your profile and user settings",
  // Advertised on the authorization server; not shown on consent or Settings cards.
  offline_access: "Refresh token (always issued)",
  calendar: "Read and write calendars and events (legacy grant)",
  drive: "Read and write Drive files and folders (legacy grant)",
  tasks: "Read and write tasks and task lists (legacy grant)",
  contacts: "Read and write contacts (legacy grant)",
  docs: "Read and write Docs and Notes (legacy grant)",
};

const GROUP_IDS: { label: string; ids: string[]; legacyId?: string }[] = [
  { label: "Calendar", ids: ["calendar.read", "calendar.write"], legacyId: "calendar" },
  { label: "Notes", ids: ["notes.read", "notes.write"] },
  { label: "Contacts", ids: ["contacts.read", "contacts.write"], legacyId: "contacts" },
  { label: "Tasks", ids: ["tasks.read", "tasks.write"], legacyId: "tasks" },
  { label: "Docs", ids: ["docs.read", "docs.write"], legacyId: "docs" },
  { label: "Drive", ids: ["drive.read", "drive.write"], legacyId: "drive" },
  { label: "Meet", ids: ["meet.read", "meet.write"] },
  { label: "Mail", ids: ["mail.read", "mail.send"] },
  { label: "Profile", ids: ["settings"] },
];

export function mcpScopeActionLabel(id: string): string {
  if (id.endsWith(".read")) return "Read";
  if (id.endsWith(".write")) return "Write";
  switch (id) {
    case "mail.send":
      return "Send";
    case "settings":
      return "Read";
    case "offline_access":
      return "Stay connected";
    case "calendar":
    case "drive":
    case "tasks":
    case "contacts":
    case "docs":
      return "Read and write";
    default:
      return id;
  }
}

export function groupMcpScopeIds(ids: string[]): McpScopeGroup[] {
  const remaining = new Set(ids);
  const groups: McpScopeGroup[] = [];
  for (const def of GROUP_IDS) {
    const scopes: McpScopeGroup["scopes"] = [];
    for (const id of def.ids) {
      if (remaining.has(id)) {
        scopes.push({ id, actionLabel: mcpScopeActionLabel(id) });
        remaining.delete(id);
      }
    }
    if (def.legacyId && remaining.has(def.legacyId)) {
      scopes.push({ id: def.legacyId, actionLabel: mcpScopeActionLabel(def.legacyId) });
      remaining.delete(def.legacyId);
    }
    if (scopes.length > 0) {
      groups.push({ label: def.label, scopes });
    }
  }
  remaining.delete("offline_access"); // protocol id, not a user-facing grant
  if (remaining.size > 0) {
    groups.push({
      label: "Other",
      scopes: [...remaining].map((id) => ({ id, actionLabel: mcpScopeActionLabel(id) })),
    });
  }
  return groups;
}

/** Advertised consent rows (no legacy aliases, no `offline_access`). */
export function mcpConsentCatalogScopeIds(): string[] {
  return GROUP_IDS.flatMap((def) => def.ids);
}

export function mcpConsentGroupsFor(ids: readonly string[]): McpConsentGroup[] {
  return groupMcpScopeIds([...ids]).map((group) => ({
    label: group.label,
    scopes: group.scopes.map((scope) => ({
      id: scope.id,
      description: MCP_SCOPE_CATALOG[scope.id] ?? scope.id,
    })),
  }));
}

/**
 * Drop ungranted rows and empty apps. Used by the permissions card in `readOnly`
 * so Settings does not show off-switches for scopes the assistant never received.
 */
export function filterMcpConsentGroupsToGranted(
  groups: McpConsentGroup[],
  grantedScopeIds: readonly string[],
): McpConsentGroup[] {
  const granted = new Set(grantedScopeIds);
  return groups
    .map((group) => ({
      ...group,
      scopes: group.scopes.filter((scope) => granted.has(scope.id)),
    }))
    .filter((group) => group.scopes.length > 0);
}

export function formatGrantDate(value: string | null | undefined, empty = "Never used"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
