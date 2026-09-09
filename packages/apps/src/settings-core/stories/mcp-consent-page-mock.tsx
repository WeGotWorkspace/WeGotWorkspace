import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { displayOriginHost } from "@/settings-core/src/display-origin-host";
import { McpConsentPermissionsCard } from "@/settings-core/src/mcp-consent-permissions-card";
import type { McpConsentGroup } from "@/settings-core/src/mcp-scope-labels";

import "./mcp-consent-page.stories.css";

export type McpConsentPageMockProps = {
  clientOrigin: string;
  username: string;
  groups: McpConsentGroup[];
};

/**
 * Catalog mock of the Passport consent page (`mcp/authorize.blade.php`).
 * Not wired into the PWA — live grant UI stays on `/oauth/authorize`.
 *
 * Layout: signed-in avatar + title above the permissions card; Deny/Allow sit below it.
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
            <span className="mcp-consent-page__origin">{displayOriginHost(clientOrigin)}</span> to
            access your workspace?
          </p>
        </header>
        <form className="mcp-consent-page__form" onSubmit={onApprove}>
          <McpConsentPermissionsCard
            groups={groups}
            checked={checked}
            onCheckedChange={(scopeId, value) =>
              setChecked((prev) => ({ ...prev, [scopeId]: value }))
            }
          />
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
