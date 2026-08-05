import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import type { DriveShareAtPath, DriveSharePrincipalEntry } from "@wgw-api-generated/drive-types";
import { Card } from "@/card/src/card";
import { buttonVariants } from "@/button/src/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { SharePrincipalSearchDropdown } from "@/share-ui/share-principal-search-dropdown";
import { accessToUIPermission } from "@/share-ui/share-access-map";
import { formatSharePathLabel, shareLabels } from "@/share-ui/share-labels";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import { SharePrincipalRow } from "@/share-ui/share-principal-row";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

type ShareTeamSectionProps = {
  atPath: DriveShareAtPath;
  mutations: ShareMutations;
  disabled?: boolean;
};

type PendingRemoval = {
  shareId: string;
  principal: string;
};

export function ShareTeamSection({ atPath, mutations, disabled = false }: ShareTeamSectionProps) {
  const groupGrants = useMemo(
    () => atPath.effectiveGrants.filter((grant) => grant.principalType === "group"),
    [atPath.effectiveGrants],
  );
  const directMemberAccess = useMemo(
    () => atPath.memberAccess.filter((member) => member.viaGroup === null),
    [atPath.memberAccess],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveSharePrincipalEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

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
    <Card
      titleIcon={<Users className="size-4" />}
      title={shareLabels.teamSectionTitle}
      description={shareLabels.teamSectionHint}
    >
      <div className="share-dialog__panel">
        {groupGrants.map((grant) => {
          const inherited = grant.source.inherited;
          const uiPermission = accessToUIPermission(grant.access);
          const active = Boolean(uiPermission);
          return (
            <SharePrincipalRow
              key={grant.principal}
              mark={
                <SharePrincipalMark
                  principalType="group"
                  displayName={grant.displayName ?? formatSharePathLabel(grant.principal)}
                  active={active}
                />
              }
              title={grant.displayName ?? formatSharePathLabel(grant.principal)}
              subtitle={shareLabels.membersSuffix(grant.memberCount ?? 0)}
              inheritedFromPath={inherited ? grant.source.sharePath : undefined}
              access={grant.access}
              editable={Boolean(grant.removal) && !inherited}
              removeDisabled={disabled}
              onAccessChange={(next) => {
                if (!grant.removal) return;
                void mutations.updateGrantAccess(
                  grant.removal.shareId,
                  grant.removal.principal ?? grant.principal,
                  next,
                );
              }}
              onRemove={
                grant.removal && !inherited
                  ? () => {
                      setPendingRemoval({
                        shareId: grant.removal!.shareId,
                        principal: grant.removal!.principal ?? grant.principal,
                      });
                    }
                  : undefined
              }
            />
          );
        })}

        {groupGrants.length > 0 && directMemberAccess.length > 0 ? (
          <div className="share-dialog__row-divider" />
        ) : null}

        {directMemberAccess.map((member) => {
          const inherited = member.source.inherited;
          const uiPermission = accessToUIPermission(member.access);
          const active = Boolean(uiPermission);
          const subtitle = inherited
            ? member.username
            : member.viaGroup
              ? shareLabels.viaGroup(formatSharePathLabel(member.viaGroup))
              : member.username;

          return (
            <SharePrincipalRow
              key={member.username}
              mark={
                <SharePrincipalMark
                  principalType="user"
                  displayName={member.displayName}
                  active={active}
                />
              }
              title={member.displayName}
              subtitle={subtitle}
              inheritedFromPath={inherited ? member.source.sharePath : undefined}
              access={member.access}
              editable={member.editable && !inherited}
              editHint={member.editHint}
              removeDisabled={disabled}
              onAccessChange={(next) => {
                if (!member.removal?.principal) return;
                void mutations.updateGrantAccess(
                  member.removal.shareId,
                  member.removal.principal,
                  next,
                );
              }}
              onRemove={
                member.removal?.principal && member.editable && !inherited
                  ? () => {
                      setPendingRemoval({
                        shareId: member.removal!.shareId,
                        principal: member.removal!.principal!,
                      });
                    }
                  : undefined
              }
            />
          );
        })}

        <div className="share-dialog__add-grant">
          <SharePrincipalSearchDropdown
            query={query}
            searching={searching}
            results={selectableResults}
            onSelect={(entry) => {
              void mutations.addTeamGrant(entry, "view").then(() => setQuery(""));
            }}
          >
            <ShareDialogInput
              value={query}
              disabled={disabled}
              placeholder={shareLabels.addTeamGrantPlaceholder}
              className="share-dialog__add-grant-input"
              onChange={(event) => setQuery(event.target.value)}
            />
          </SharePrincipalSearchDropdown>
        </div>
      </div>

      <AlertDialog
        open={!!pendingRemoval}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{shareLabels.removeGrantTitle}</AlertDialogTitle>
            <AlertDialogDescription>{shareLabels.removeGrantConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{shareLabels.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (!pendingRemoval) return;
                void mutations.updateGrantAccess(
                  pendingRemoval.shareId,
                  pendingRemoval.principal,
                  null,
                );
                setPendingRemoval(null);
              }}
            >
              {shareLabels.confirmContinue}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
