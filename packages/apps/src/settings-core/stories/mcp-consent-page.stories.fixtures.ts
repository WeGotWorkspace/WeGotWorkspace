/**
 * Story fixtures for the consent mock. Catalog + grouping live in
 * `mcp-scope-labels.ts` (same map as Settings Connected assistants).
 */

import {
  mcpConsentCatalogScopeIds,
  mcpConsentGroupsFor,
  MCP_SCOPE_CATALOG,
  type McpConsentGroup,
} from "@/settings-core/src/mcp-scope-labels";

export type { McpConsentGroup, McpConsentScope } from "@/settings-core/src/mcp-scope-labels";

export const MCP_CONSENT_CATALOG = MCP_SCOPE_CATALOG;

export { mcpConsentGroupsFor };

export const MCP_CONSENT_ALL_IDS: string[] = [
  ...mcpConsentCatalogScopeIds(),
  // Included so grouping can prove it is dropped from the consent mock.
  "offline_access",
];

export const MCP_CONSENT_DEFAULT_GROUPS: McpConsentGroup[] =
  mcpConsentGroupsFor(MCP_CONSENT_ALL_IDS);
