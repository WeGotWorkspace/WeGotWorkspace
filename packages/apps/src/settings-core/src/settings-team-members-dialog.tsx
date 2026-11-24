import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/button/src/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  TEAM_CANDIDATE_MIN_QUERY,
  type TeamMember,
  type TeamMemberCandidate,
  type TeamMembersOperations,
} from "@/lib/api/wgw/teams";
import { type ShareSearchOption } from "@/share-ui/share-principal-search-dropdown";
import { teamMembersLabels as labels } from "@/share-ui/team-members-labels";
import { AutosaveStatusProvider, AutosaveStatusTag, useTrackAutosave } from "@/ui/autosave-status";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { TeamMembersCard } from "@/share-ui/team-members-card";

export type SettingsTeamMembersDialogProps = {
  open: boolean;
  team: { slug: string; displayName: string } | null;
  /** The signed-in user, to word "leave" instead of "remove". */
  currentUsername: string;
  operations: TeamMembersOperations;
  onOpenChange: (open: boolean) => void;
  /** After every change, with the Team's member list as the server has it. */
  onMembersChange?: (teamSlug: string, members: TeamMember[]) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : labels.genericError;
}

/**
 * A team admin's view of one Team: add someone, set who is team admin, remove someone.
 * Every change is sent at once; the dialog only has Done.
 */
export function SettingsTeamMembersDialog(props: SettingsTeamMembersDialogProps) {
  return (
    <AutosaveStatusProvider>
      <TeamMembersDialogBody {...props} />
    </AutosaveStatusProvider>
  );
}

function TeamMembersDialogBody({
  open,
  team,
  currentUsername,
  operations,
  onOpenChange,
  onMembersChange,
}: SettingsTeamMembersDialogProps) {
  const track = useTrackAutosave();
  const slug = team?.slug ?? null;
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamMemberCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<TeamMember | null>(null);

  // The caller's callback is usually a new function each render; reading it through a ref
  // keeps `reload` stable, so the open effect below does not run again after every change.
  const onMembersChangeRef = useRef(onMembersChange);
  useEffect(() => {
    onMembersChangeRef.current = onMembersChange;
  }, [onMembersChange]);

  const reload = useCallback(
    async (teamSlug: string) => {
      const list = await operations.listMembers(teamSlug);
      setMembers(list);
      onMembersChangeRef.current?.(teamSlug, list);
    },
    [operations],
  );

  useEffect(() => {
    if (!open || slug === null) return;
    setMembers(null);
    setError(null);
    setQuery("");
    setResults([]);
    void reload(slug).catch((caught: unknown) => setError(errorMessage(caught)));
  }, [open, slug, reload]);

  useEffect(() => {
    const trimmed = query.trim();
    if (slug === null || trimmed.length < TEAM_CANDIDATE_MIN_QUERY) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void operations
        .searchCandidates(slug, trimmed)
        .then(setResults)
        .catch((caught: unknown) => setError(errorMessage(caught)))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [operations, query, slug]);

  const searchOptions: ShareSearchOption[] = useMemo(
    () =>
      results
        .filter((entry) => !entry.isMember)
        .map((entry) => ({
          id: entry.username,
          displayName: entry.displayName,
          principalType: "user" as const,
          meta: entry.email !== "" ? entry.email : entry.username,
        })),
    [results],
  );

  const change = (action: (teamSlug: string) => Promise<void>) => {
    if (slug === null) return;
    setError(null);
    void track(() => action(slug).then(() => reload(slug))).catch((caught: unknown) =>
      setError(errorMessage(caught)),
    );
  };

  const removingSelf = pendingRemoval?.username === currentUsername;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="settings-team-members-dialog">
          <DialogHeader end={<AutosaveStatusTag />}>
            <DialogTitle>
              {team ? labels.title(team.displayName) : labels.titleFallback}
            </DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <FieldLabelRow
            layout="inline"
            fill
            label={labels.nameLabel}
            htmlFor="settings-team-name"
            description={labels.nameHint}
          >
            <Input id="settings-team-name" value={team?.displayName ?? ""} disabled readOnly />
          </FieldLabelRow>
          <TeamMembersCard
            members={(members ?? []).map((member) => ({ ...member, id: member.username }))}
            query={query}
            onQueryChange={setQuery}
            candidates={searchOptions}
            searching={searching}
            minQueryLength={TEAM_CANDIDATE_MIN_QUERY}
            onAdd={(username) => change((teamSlug) => operations.addMember(teamSlug, username))}
            onRoleChange={(member, role) =>
              change((teamSlug) =>
                role === "teamAdmin"
                  ? operations.appointTeamAdmin(teamSlug, member.username)
                  : operations.dismissTeamAdmin(teamSlug, member.username),
              )
            }
            onRemove={(member) =>
              setPendingRemoval((members ?? []).find((m) => m.username === member.username) ?? null)
            }
            status={
              error !== null ? (
                <p className="settings-team-members-dialog__error" role="alert">
                  {error}
                </p>
              ) : members === null ? (
                <p className="settings-team-members-dialog__state" role="status">
                  {labels.loading}
                </p>
              ) : null
            }
          />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{labels.done}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(next) => !next && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removingSelf
                ? labels.leaveTitle(team?.displayName ?? "")
                : labels.removeTitle(pendingRemoval?.displayName ?? "", team?.displayName ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removingSelf ? labels.leaveConfirm : labels.removeConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                const member = pendingRemoval;
                setPendingRemoval(null);
                if (!member) return;
                if (member.username === currentUsername) {
                  // The user can no longer manage this Team: close instead of reloading into a 404.
                  if (slug !== null) {
                    void operations
                      .removeMember(slug, member.username)
                      .then(() => {
                        onMembersChangeRef.current?.(slug, []);
                        onOpenChange(false);
                      })
                      .catch((caught: unknown) => setError(errorMessage(caught)));
                  }
                  return;
                }
                change((teamSlug) => operations.removeMember(teamSlug, member.username));
              }}
            >
              {removingSelf ? labels.leaveAction : labels.removeAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
