import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { Callout } from "@/callout/src/callout";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { Switch } from "@/ui/switch";
import { workspaceAppIconInlineMarkup } from "@/lib/workspace-app-icon-svgs";
import { MCP_CONSENT_GROUP_APP_ID } from "@/settings-core/src/mcp-scope-labels";
import { MCP_CONSENT_CATALOG, type McpConsentGroup } from "./mcp-consent-page.stories.fixtures";

import "./mcp-consent-page.stories.css";

export type McpConsentPageMockProps = {
  clientOrigin: string;
  username: string;
  groups: McpConsentGroup[];
};

function scopeInputId(scopeId: string): string {
  return `mcp-consent-${scopeId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function displayOriginHost(origin: string): string {
  try {
    const url = origin.includes("://") ? new URL(origin) : new URL(`https://${origin}`);
    return url.port !== "" ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return origin.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}

/**
 * Catalog mock of the Passport consent page (`mcp/authorize.blade.php`).
 * Not wired into the PWA — live grant UI stays on `/oauth/authorize`.
 *
 * Layout: header + warning sit above the permissions card; Deny/Allow sit below it.
 */
export function McpConsentPageMock({
  clientOrigin,
  username,
  groups,
}: McpConsentPageMockProps): ReactNode {
  const allIds = useMemo(
    () => groups.flatMap((group) => group.scopes.map((scope) => scope.id)),
    [groups],
  );
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allIds.map((id) => [id, true])),
  );
  const [outcome, setOutcome] = useState<string | null>(null);

  const onApprove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const granted = allIds.filter((id) => checked[id]);
    setOutcome(
      granted.length === 0
        ? "Allow (mock): no scopes selected."
        : `Allow (mock): ${granted.join(", ")}`,
    );
  };

  const onDeny = () => {
    setOutcome("Deny (mock): no grant.");
  };

  return (
    <div className="mcp-consent-page">
      <div className="mcp-consent-page__column">
        <header className="mcp-consent-page__header">
          <UserAvatar
            displayName={username}
            compact
            className="mcp-consent-page__avatar"
            ariaLabel={`Signed in as ${username}`}
          />
          <h1 className="mcp-consent-page__title">Connect assistant</h1>
          <p className="mcp-consent-page__lead">
            Allow{" "}
            <strong className="mcp-consent-page__origin">{displayOriginHost(clientOrigin)}</strong>{" "}
            to access your workspace?
          </p>
        </header>
        <form className="mcp-consent-page__form" onSubmit={onApprove}>
          <Card className="mcp-consent-page__card">
            <p className="mcp-consent-page__permissions" id="mcp-consent-permissions-heading">
              Permissions
            </p>
            <p className="mcp-consent-page__hint" id="mcp-consent-permissions-hint">
              Choose what this assistant may do.
            </p>
            <Callout
              severity="warning"
              title="Content you allow here leaves this instance"
              message="It is sent to the assistant vendor’s model. You can revoke access later in Settings → Connected assistants."
            />
            <div
              className="mcp-consent-page__groups"
              role="group"
              aria-labelledby="mcp-consent-permissions-heading"
              aria-describedby="mcp-consent-permissions-hint"
            >
              {groups.map((group) => {
                const appId = MCP_CONSENT_GROUP_APP_ID[group.label];
                return (
                  <section key={group.label} className="mcp-consent-page__group">
                    <h2 className="mcp-consent-page__heading">
                      {appId ? (
                        <span
                          className="mcp-consent-page__app-icon"
                          aria-hidden
                          dangerouslySetInnerHTML={{ __html: workspaceAppIconInlineMarkup(appId) }}
                        />
                      ) : null}
                      {group.label}
                    </h2>
                    {group.scopes.map((scope) => {
                      const inputId = scopeInputId(scope.id);
                      const descId = `${inputId}-desc`;
                      const description = MCP_CONSENT_CATALOG[scope.id] ?? scope.description;
                      return (
                        <div key={scope.id} className="mcp-consent-page__scope">
                          <span className="mcp-consent-page__desc" id={descId}>
                            {description}
                          </span>
                          <Switch
                            id={inputId}
                            checked={Boolean(checked[scope.id])}
                            aria-labelledby={descId}
                            onCheckedChange={(value) =>
                              setChecked((prev) => ({ ...prev, [scope.id]: value }))
                            }
                          />
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </Card>
          <div className="mcp-consent-page__actions">
            <Button type="button" variant="outline" label="Deny" onClick={onDeny} />
            <Button type="submit" variant="primary" label="Allow" />
          </div>
        </form>
        {outcome ? (
          <p className="mcp-consent-page__outcome" role="status">
            {outcome}
          </p>
        ) : null}
      </div>
    </div>
  );
}
