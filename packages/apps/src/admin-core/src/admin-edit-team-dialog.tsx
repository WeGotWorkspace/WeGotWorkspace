import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { TeamMembersCard } from "@/share-ui/team-members-card";
import { type ShareSearchOption } from "@/share-ui/share-principal-search-dropdown";
import { AutosaveStatusProvider, AutosaveStatusTag, useTrackAutosave } from "@/ui/autosave-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NO_AUTOFILL } from "@/ui/no-autofill";

export type EditTeamDraft = {
  name: string;
  memberUserIds: string[];
  teamAdminUserIds: string[];
};

type EditTeamUser = {
  id: string;
  displayName: string;
  username: string;
  email?: string;
  groups: string[];
};

export type EditTeamDialogProps = {
  open: boolean;
  team: { id: string; displayName: string; teamAdmins: string[] } | null;
  users: readonly EditTeamUser[];
  onOpenChange: (open: boolean) => void;
  /** Stores the whole draft; resolves false when it could not be stored. */
  onSave: (draft: EditTeamDraft) => Promise<boolean>;
};

function draftOf(team: EditTeamDialogProps["team"], users: readonly EditTeamUser[]): EditTeamDraft {
  if (!team) return { name: "", memberUserIds: [], teamAdminUserIds: [] };
  return {
    name: team.displayName,
    memberUserIds: users.filter((user) => user.groups.includes(team.id)).map((user) => user.id),
    teamAdminUserIds: users
      .filter((user) => team.teamAdmins.includes(user.username))
      .map((user) => user.id),
  };
}

/**
 * Edit team (organization admin): rename, add and remove members, set who is team admin.
 * Every change saves on its own (the name after a short pause); the header shows the save
 * state and the dialog only has Done, like the other autosaving dialogs.
 */
export function EditTeamDialog(props: EditTeamDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <AutosaveStatusProvider>
          <EditTeamBody {...props} />
        </AutosaveStatusProvider>
      </DialogContent>
    </Dialog>
  );
}

function EditTeamBody({ open, team, users, onOpenChange, onSave }: EditTeamDialogProps) {
  const nameId = useId();
  const [draft, setDraft] = useState<EditTeamDraft>(() => draftOf(team, users));
  const [query, setQuery] = useState("");
  const draftRef = useRef(draft);
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const track = useTrackAutosave();

  // Reset once per opening; later prop updates (our own saves) must not clobber the draft.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const initial = draftOf(team, users);
    draftRef.current = initial;
    setDraft(initial);
    setQuery("");
  }, [open, team, users]);

  // One save at a time, each with the newest draft.
  const save = useCallback(() => {
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = undefined;
    queueRef.current = queueRef.current
      .then(() =>
        track(async () => {
          const current = draftRef.current;
          if (!current.name.trim()) throw new Error("A team needs a name.");
          if (!(await onSave(current))) throw new Error("Not saved.");
        }),
      )
      .catch(() => undefined);
  }, [onSave, track]);

  const flushName = () => {
    if (nameTimerRef.current !== undefined) save();
  };

  const update = (next: EditTeamDraft, delay: number) => {
    draftRef.current = next;
    setDraft(next);
    clearTimeout(nameTimerRef.current);
    if (delay > 0) nameTimerRef.current = setTimeout(save, delay);
    else save();
  };

  // Closing with Escape or the close button still stores a name typed just before.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (nameTimerRef.current !== undefined) saveRef.current();
    },
    [],
  );

  const needle = query.trim().toLowerCase();
  const candidates: ShareSearchOption[] =
    needle === ""
      ? []
      : users
          .filter(
            (user) =>
              !draft.memberUserIds.includes(user.id) &&
              [user.displayName, user.username, user.email ?? ""].some((field) =>
                field.toLowerCase().includes(needle),
              ),
          )
          .map((user) => ({
            id: user.id,
            displayName: user.displayName,
            principalType: "user" as const,
            meta: user.email ? user.email : user.username,
          }));

  const close = () => {
    flushName();
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader end={<AutosaveStatusTag />}>
        <DialogTitle>Edit team</DialogTitle>
        <DialogDescription>Rename and assign members.</DialogDescription>
      </DialogHeader>
      <FormField layout="inline" fill label="Team name" htmlFor={nameId}>
        <Input
          id={nameId}
          {...NO_AUTOFILL}
          value={draft.name}
          onChange={(event) =>
            update({ ...draft, name: event.currentTarget.value }, FORM_AUTOSAVE_DELAY_MS)
          }
          onBlur={flushName}
          onKeyDown={(event) => {
            if (event.key === "Enter") flushName();
          }}
        />
      </FormField>
      <TeamMembersCard
        members={users
          .filter((user) => draft.memberUserIds.includes(user.id))
          .map((user) => ({
            id: user.id,
            displayName: user.displayName,
            username: user.username,
            isTeamAdmin: draft.teamAdminUserIds.includes(user.id),
          }))}
        query={query}
        onQueryChange={setQuery}
        candidates={candidates}
        minQueryLength={1}
        onAdd={(userId) => update({ ...draft, memberUserIds: [...draft.memberUserIds, userId] }, 0)}
        onRoleChange={(member, role) =>
          update(
            {
              ...draft,
              teamAdminUserIds:
                role === "teamAdmin"
                  ? [...draft.teamAdminUserIds.filter((id) => id !== member.id), member.id]
                  : draft.teamAdminUserIds.filter((id) => id !== member.id),
            },
            0,
          )
        }
        onRemove={(member) =>
          update(
            {
              ...draft,
              memberUserIds: draft.memberUserIds.filter((id) => id !== member.id),
              teamAdminUserIds: draft.teamAdminUserIds.filter((id) => id !== member.id),
            },
            0,
          )
        }
      />
      <DialogFooter>
        <Button onClick={close}>Done</Button>
      </DialogFooter>
    </>
  );
}
