/**
 * Story fixtures for the consent mock. Catalog + grouping live in
 * `mcp-scope-labels.ts` (same map as Settings Connected assistants).
 */

import { groupMcpScopeIds, MCP_SCOPE_CATALOG } from "@/settings-core/src/mcp-scope-labels";

export type McpConsentScope = {
  id: string;
  description: string;
};

export type McpConsentGroup = {
  label: string;
  scopes: McpConsentScope[];
};

export const MCP_CONSENT_CATALOG = MCP_SCOPE_CATALOG;

export function mcpConsentGroupsFor(ids: string[]): McpConsentGroup[] {
  return groupMcpScopeIds(ids).map((group) => ({
    label: group.label,
    scopes: group.scopes.map((scope) => ({
      id: scope.id,
      description: MCP_SCOPE_CATALOG[scope.id] ?? scope.id,
    })),
  }));
}

export const MCP_CONSENT_ALL_IDS: string[] = [
  "calendar.read",
  "calendar.write",
  "notes.read",
  "notes.write",
  "contacts.read",
  "contacts.write",
  "tasks.read",
  "tasks.write",
  "docs.read",
  "docs.write",
  "drive.read",
  "drive.write",
  "meet.read",
  "meet.write",
  "mail.read",
  "mail.send",
  "settings",
  // Included so grouping can prove it is dropped from the consent mock.
  "offline_access",
];

export const MCP_CONSENT_DEFAULT_GROUPS: McpConsentGroup[] =
  mcpConsentGroupsFor(MCP_CONSENT_ALL_IDS);
