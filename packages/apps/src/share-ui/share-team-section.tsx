import { useEffect, useMemo, useState } from "react";
import { Check, Users, Users2 } from "lucide-react";
import type { DriveShareAtPath, DriveSharePrincipalEntry } from "@wgw-api-generated/drive-types";
import { Input } from "@/ui/input";
import { initialsFromDisplayName, UserAvatar } from "@/user-avatar/src/user-avatar";
import { accessToUIPermission } from "@/share-ui/share-access-map";
import { formatSharePathLabel, shareLabels } from "@/share-ui/share-labels";
import { SharePrincipalRow } from "@/share-ui/share-principal-row";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

type ShareTeamSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  onOpenAccess?: (path: string) => void;
  disabled?: boolean;
};

export function ShareTeamSection({
  atPath,
  mutations,
  onOpenAccess,
  disabled = false,
}: ShareTeamSectionProps) {
  const groupGrants = useMemo(
    () => atPath.effectiveGrants.filter((grant) => grant.principalType === "group"),
    [atPath.effectiveGrants],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveSharePrincipalEntry[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void mutations
        .searchPrincipals(trimmed)
        .then((entries) => setResults(entries))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mutations, query]);

  const existingPrincipals = useMemo(() => {
    const principals = new Set<string>();
    for (const grant of atPath.effectiveGrants) {
      if (grant.principalType !== "email") principals.add(grant.principal);
    }
    for (const member of atPath.memberAccess) {
      principals.add(member.username);
    }
    return principals;
  }, [atPath.effectiveGrants, atPath.memberAccess]);

  const selectableResults = results.filter((entry) => !existingPrincipals.has(entry.principal));

  return (
    <section>
      <div className="share-dialog__section-heading">
        <Users className="share-dialog__section-icon" aria-hidden />
        <h3 className="share-dialog__section-title">{shareLabels.teamSectionTitle}</h3>
      </div>
      <p className="share-dialog__section-hint">{shareLabels.teamSectionHint}</p>

      <div className="share-dialog__panel">
        {groupGrants.map((grant) => {
          const inherited = grant.source.inherited;
          const uiPermission = accessToUIPermission(grant.access);
          const active = Boolean(uiPermission);
          return (
            <SharePrincipalRow
              key={grant.principal}
              mark={
                <div
                  className={`share-dialog__group-mark ${
                    active ? "share-dialog__group-mark--active" : "share-dialog__group-mark--idle"
                  }`}
                >
                  <Users2 className="size-3.5" aria-hidden />
                </div>
              }
              title={grant.displayName ?? formatSharePathLabel(grant.principal)}
              subtitle={
                inherited
                  ? `${shareLabels.inheritedFrom(formatSharePathLabel(grant.source.sharePath))} · ${shareLabels.membersSuffix(grant.memberCount ?? 0)}`
                  : shareLabels.membersSuffix(grant.memberCount ?? 0)
              }
              inheritedFromPath={inherited ? grant.source.sharePath : undefined}
              access={grant.access}
              editable={Boolean(grant.removal) && !inherited}
              allowNone={Boolean(grant.removal) && !inherited}
              onOpenAccess={onOpenAccess}
              onAccessChange={(next) => {
                if (!grant.removal) return;
                void mutations.updateGrantAccess(
                  grant.removal.shareId,
                  grant.removal.principal ?? grant.principal,
                  next === "none" ? null : next,
                );
              }}
            />
          );
        })}

        {groupGrants.length > 0 && atPath.memberAccess.length > 0 ? (
          <div className="share-dialog__row-divider" />
        ) : null}

        {atPath.memberAccess.map((member) => {
          const inherited = member.source.inherited;
          const uiPermission = accessToUIPermission(member.access);
          const active = Boolean(uiPermission) || member.access === "full";
          const subtitle = inherited
            ? (member.editHint ??
              `${shareLabels.inheritedFrom(formatSharePathLabel(member.source.sharePath))} · ${member.username}`)
            : member.viaGroup
              ? shareLabels.viaGroup(formatSharePathLabel(member.viaGroup))
              : member.username;

          return (
            <SharePrincipalRow
              key={member.username}
              mark={
                <div
                  className={`share-dialog__member-mark ${
                    active ? "share-dialog__member-mark--active" : "share-dialog__member-mark--idle"
                  }`}
                >
                  {active && uiPermission ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    initialsFromDisplayName(member.displayName)
                  )}
                </div>
              }
              title={member.displayName}
              subtitle={subtitle}
              inheritedFromPath={inherited ? member.source.sharePath : undefined}
              access={member.access}
              editable={member.editable && !inherited}
              editHint={member.editHint}
              allowNone={Boolean(member.removal) && member.editable && !inherited}
              onOpenAccess={onOpenAccess}
              onAccessChange={(next) => {
                if (!member.removal?.principal) return;
                void mutations.updateGrantAccess(
                  member.removal.shareId,
                  member.removal.principal,
                  next === "none" ? null : next,
                );
              }}
            />
          );
        })}

        <div className="share-dialog__add-grant">
          <Input
            value={query}
            disabled={disabled}
            placeholder={shareLabels.addTeamGrantPlaceholder}
            className="share-dialog__add-grant-input"
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching ? <p className="share-dialog__row-subtitle mt-1 px-1">Searching…</p> : null}
          {selectableResults.length > 0 ? (
            <div className="share-dialog__add-grant-results">
              {selectableResults.map((entry) => (
                <button
                  key={entry.principal}
                  type="button"
                  className="share-dialog__add-grant-option"
                  onClick={() => {
                    void mutations.addTeamGrant(entry, "view").then(() => setQuery(""));
                  }}
                >
                  <UserAvatar displayName={entry.displayName} compact size="sm" />
                  <span>{entry.displayName}</span>
                  {entry.memberCount != null ? (
                    <span className="share-dialog__row-subtitle">
                      {shareLabels.membersSuffix(entry.memberCount)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
