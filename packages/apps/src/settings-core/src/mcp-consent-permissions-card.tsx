import { useId, useMemo, type ReactNode } from "react";
import { Card } from "@/card/src/card";
import { Switch } from "@/ui/switch";
import { workspaceAppIconInlineMarkup } from "@/lib/workspace-app-icon-svgs";
import { McpAssistantDataWarning } from "@/settings-core/src/mcp-assistant-data-warning";
import {
  filterMcpConsentGroupsToGranted,
  MCP_CONSENT_GROUP_APP_ID,
  MCP_SCOPE_CATALOG,
  type McpConsentGroup,
} from "@/settings-core/src/mcp-scope-labels";

import "./mcp-consent-permissions-card.css";

export const MCP_CONSENT_PERMISSIONS_TITLE = "Permissions";
export const MCP_CONSENT_PERMISSIONS_HINT = "Choose what this assistant may do.";

export type McpConsentPermissionsCardProps = {
  groups: McpConsentGroup[];
  /**
   * When true, switches are disabled and only `grantedScopeIds` (or checked-on
   * ids) are shown. Apps with no granted scopes are omitted.
   */
  readOnly?: boolean;
  /**
   * Card chrome around the permissions list. Default `true` for consent.
   * Settings Connected assistants passes `false`.
   */
  framed?: boolean;
  /** Heading above the scopes list. Default matches OAuth consent. */
  title?: string;
  /** Subtitle under the heading. Default matches OAuth consent. */
  hint?: string;
  /** Warning callout about content leaving the instance. Default true for consent. */
  showWarning?: boolean;
  /** Scope id → on/off. Interactive consent. */
  checked?: Record<string, boolean>;
  /** Granted scope ids. In `readOnly`, visibility is this set (all shown switches on). */
  grantedScopeIds?: readonly string[];
  onCheckedChange?: (scopeId: string, checked: boolean) => void;
  idPrefix?: string;
};

function scopeInputId(prefix: string, scopeId: string): string {
  return `${prefix}-${scopeId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function grantedIdsForReadOnly(
  grantedScopeIds: readonly string[] | undefined,
  checked: Record<string, boolean>,
): string[] {
  if (grantedScopeIds) {
    return [...grantedScopeIds];
  }
  return Object.entries(checked)
    .filter(([, on]) => on)
    .map(([id]) => id);
}

/**
 * Shared Connect-assistant permissions card (app groups, descriptions, switches,
 * warning). Interactive on the consent mock; `readOnly` on Settings Connected assistants.
 */
export function McpConsentPermissionsCard({
  groups,
  readOnly = false,
  framed = true,
  title = MCP_CONSENT_PERMISSIONS_TITLE,
  hint = MCP_CONSENT_PERMISSIONS_HINT,
  showWarning = true,
  checked = {},
  grantedScopeIds,
  onCheckedChange,
  idPrefix,
}: McpConsentPermissionsCardProps): ReactNode {
  const reactId = useId();
  const prefix = idPrefix ?? `mcp-consent${reactId.replace(/:/g, "")}`;
  const headingId = `${prefix}-permissions-heading`;
  const hintId = `${prefix}-permissions-hint`;

  const visibleGroups = useMemo(() => {
    if (!readOnly) {
      return groups;
    }
    return filterMcpConsentGroupsToGranted(groups, grantedIdsForReadOnly(grantedScopeIds, checked));
  }, [checked, grantedScopeIds, groups, readOnly]);

  const body = (
    <>
      <p className="mcp-consent-permissions-card__permissions" id={headingId}>
        {title}
      </p>
      <p className="mcp-consent-permissions-card__hint" id={hintId}>
        {hint}
      </p>
      {showWarning ? <McpAssistantDataWarning /> : null}
      <div
        className="mcp-consent-permissions-card__groups"
        role="group"
        aria-labelledby={headingId}
        aria-describedby={hintId}
      >
        {visibleGroups.map((group) => {
          const appId = MCP_CONSENT_GROUP_APP_ID[group.label];
          return (
            <section key={group.label} className="mcp-consent-permissions-card__group">
              <h2 className="mcp-consent-permissions-card__heading">
                {appId ? (
                  <span
                    className="mcp-consent-permissions-card__app-icon"
                    aria-hidden
                    dangerouslySetInnerHTML={{ __html: workspaceAppIconInlineMarkup(appId) }}
                  />
                ) : null}
                {group.label}
              </h2>
              {group.scopes.map((scope) => {
                const inputId = scopeInputId(prefix, scope.id);
                const descId = `${inputId}-desc`;
                const description = MCP_SCOPE_CATALOG[scope.id] ?? scope.description;
                const isOn = readOnly ? true : Boolean(checked[scope.id]);
                return (
                  <div key={scope.id} className="mcp-consent-permissions-card__scope">
                    <span className="mcp-consent-permissions-card__desc" id={descId}>
                      {description}
                    </span>
                    <Switch
                      id={inputId}
                      checked={isOn}
                      disabled={readOnly}
                      aria-labelledby={descId}
                      onCheckedChange={
                        readOnly ? undefined : (value) => onCheckedChange?.(scope.id, value)
                      }
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );

  if (framed) {
    return <Card className="mcp-consent-permissions-card">{body}</Card>;
  }

  return (
    <div className="mcp-consent-permissions-card mcp-consent-permissions-card--plain">{body}</div>
  );
}
