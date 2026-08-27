import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { buttonVariants } from "@/button/src/button";
import {
  displayNameForSharePrincipal,
  shareGrantEntries,
  sharePermissionFromRights,
  shareRightsForPermission,
  type CollectionSharePrincipal,
  type CollectionShareWith,
} from "@/share-ui/collection-share";
import { NOTES_SHARE_UI_PERMISSIONS } from "@/share-ui/share-access-map";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import { SharePrincipalRow } from "@/share-ui/share-principal-row";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
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

export type CollectionShareSectionCopy = {
  title: string;
  hint: string;
  placeholder: string;
  empty: string;
  offline: string;
  removeTitle: string;
  removeConfirm: string;
};

export type CollectionShareSectionProps = {
  collectionId: string;
  shareWith?: CollectionShareWith | null;
  copy: CollectionShareSectionCopy;
  knownPrincipals?: readonly CollectionSharePrincipal[];
  disabled?: boolean;
  online?: boolean;
  dialogClassName?: string;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (collectionId: string, shareWith: CollectionShareWith) => Promise<void>;
};

export function CollectionShareSection({
  collectionId,
  shareWith,
  copy,
  knownPrincipals = [],
  disabled = false,
  online = true,
  dialogClassName,
  onSearchPrincipals,
  onPatchShareWith,
}: CollectionShareSectionProps) {
  const locked = disabled || !online;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionSharePrincipal[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearchPrincipals(trimmed)
        .then((entries) => setResults(entries))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [onSearchPrincipals, query]);

  const grants = useMemo(() => shareGrantEntries(shareWith), [shareWith]);
  const existingIds = useMemo(() => new Set(grants.map((grant) => grant.id)), [grants]);
  const selectableResults = results.filter((entry) => !existingIds.has(entry.id));
  const searchOptions: ShareSearchOption[] = selectableResults.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    principalType: entry.principalType,
    meta: entry.memberCount != null ? shareLabels.membersSuffix(entry.memberCount) : undefined,
  }));

  const patchShare = async (nextShareWith: CollectionShareWith): Promise<void> => {
    if (locked || busy) return;
    setBusy(true);
    try {
      await onPatchShareWith(collectionId, nextShareWith);
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!online ? <p className="share-dialog__error">{copy.offline}</p> : null}
      <ShareAccessCard
        titleIcon={<Users className="size-4" />}
        title={copy.title}
        description={copy.hint}
        addControl={
          <SharePrincipalSearchDropdown
            query={query}
            searching={searching}
            results={searchOptions}
            emptyLabel={copy.empty}
            listLabel={copy.title}
            onSelect={(option) => {
              const entry = selectableResults.find((row) => row.id === option.id);
              if (!entry) return;
              void patchShare({
                [entry.id]: shareRightsForPermission("view"),
              });
            }}
          >
            <ShareDialogInput
              value={query}
              disabled={locked || busy}
              placeholder={copy.placeholder}
              className="share-dialog__add-grant-input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </SharePrincipalSearchDropdown>
        }
      >
        {grants.map((grant) => {
          const title = displayNameForSharePrincipal(grant.id, knownPrincipals);
          const permission = sharePermissionFromRights(grant.rights);
          return (
            <SharePrincipalRow
              key={grant.id}
              mark={
                <SharePrincipalMark
                  principalType={grant.isGroup ? "group" : "user"}
                  displayName={title}
                  active
                />
              }
              title={title}
              subtitle={grant.isGroup ? undefined : grant.id}
              access={permission === "edit" ? "edit" : "view"}
              editable={!locked && !busy}
              removeDisabled={locked || busy}
              permissions={NOTES_SHARE_UI_PERMISSIONS}
              onAccessChange={(next) => {
                void patchShare({
                  [grant.id]: shareRightsForPermission(next),
                });
              }}
              onRemove={() => setPendingRemoval(grant.id)}
            />
          );
        })}
      </ShareAccessCard>

      <AlertDialog
        open={pendingRemoval != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent className={dialogClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.removeConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{shareLabels.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (!pendingRemoval) return;
                const id = pendingRemoval;
                setPendingRemoval(null);
                void patchShare({ [id]: null });
              }}
            >
              {shareLabels.confirmContinue}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
