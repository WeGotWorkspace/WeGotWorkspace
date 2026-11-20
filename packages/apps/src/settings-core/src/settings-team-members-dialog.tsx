import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
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
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
import { ShareRowSelect, type ShareRowSelectOption } from "@/share-ui/share-row-select";
import { teamMembersLabels as labels } from "@/settings-core/src/settings-team-members-labels";

type TeamRole = "member" | "teamAdmin";

const ROLE_OPTIONS: readonly ShareRowSelectOption<TeamRole>[] = [
  { value: "member", label: labels.roleMember },
  { value: "teamAdmin", label: labels.roleTeamAdmin },
];

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
export function SettingsTeamMembersDialog({
  open,
  team,
  currentUsername,
  operations,
  onOpenChange,
  onMembersChange,
}: SettingsTeamMembersDialogProps) {
  const slug = team?.slug ?? null;
  const addFieldId = useId();
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
    void action(slug)
      .then(() => reload(slug))
      .catch((caught: unknown) => setError(errorMessage(caught)));
  };

  const removingSelf = pendingRemoval?.username === currentUsername;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="settings-team-members-dialog">
          <DialogHeader>
            <DialogTitle>
              {team ? labels.title(team.displayName) : labels.titleFallback}
            </DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <ShareAccessCard
            htmlFor={addFieldId}
            icon={<Users aria-hidden />}
            title={labels.sectionTitle}
            description={labels.sectionHint}
            addControl={
              <SharePrincipalSearchDropdown
                query={query}
                searching={searching}
                results={searchOptions}
                emptyLabel={labels.noCandidates}
                listLabel={labels.sectionTitle}
                minQueryLength={TEAM_CANDIDATE_MIN_QUERY}
                onSelect={(option) => {
                  setQuery("");
                  change((teamSlug) => operations.addMember(teamSlug, option.id));
                }}
              >
                <ShareDialogInput
                  id={addFieldId}
                  value={query}
                  placeholder={labels.addPlaceholder}
                  className="share-dialog__add-grant-input"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </SharePrincipalSearchDropdown>
            }
          >
            {error !== null ? (
              <p className="settings-team-members-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
            {members === null && error === null ? (
              <p className="settings-team-members-dialog__state" role="status">
                {labels.loading}
              </p>
            ) : null}
            {(members ?? []).map((member) => (
              <ShareAccessRow
                key={member.username}
                mark={
                  <SharePrincipalMark
                    principalType="user"
                    displayName={member.displayName}
                    subtitle={member.username}
                    size="sm"
                    labeled
                  />
                }
                trailing={
                  <ShareRowSelect<TeamRole>
                    value={member.isTeamAdmin ? "teamAdmin" : "member"}
                    options={ROLE_OPTIONS}
                    aria-label={labels.roleOf(member.displayName)}
                    onChange={(next) =>
                      change((teamSlug) =>
                        next === "teamAdmin"
                          ? operations.appointTeamAdmin(teamSlug, member.username)
                          : operations.dismissTeamAdmin(teamSlug, member.username),
                      )
                    }
                  />
                }
                removeLabel={labels.removeLabel(member.displayName)}
                onRemove={() => setPendingRemoval(member)}
              />
            ))}
          </ShareAccessCard>
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
