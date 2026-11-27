import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import type { Task, TaskListMember, TaskListMembersResult } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  isViewerParticipant,
  removeTaskParticipant,
  taskAssignees,
  toggleTaskAssignee,
  type TaskAssignee,
} from "@/tasks-core/src/tasks-assignees";
import {
  TasksAssigneePicker,
  type TaskAssigneeMembersState,
} from "@/tasks-core/src/tasks-assignee-picker";
import { cn } from "@/lib/utils";
import "@/tasks-core/src/tasks-assignees.css";

/** Up to `max` overlapping avatars (three by default, two in a list row), then a "+N" disc; each name shows on hover. */
export function TaskAssigneeAvatars({
  assignees,
  max = 3,
  moreLabel,
  className,
}: {
  assignees: TaskAssignee[];
  max?: number;
  moreLabel: (count: number) => string;
  className?: string;
}) {
  if (assignees.length === 0) return null;
  const shown = assignees.slice(0, max);
  const more = assignees.length - shown.length;
  return (
    <span className={cn("tasks-assignee-avatars", className)}>
      {shown.map((assignee) => (
        <span key={assignee.id} className="tasks-assignee-avatars__item" title={assignee.name}>
          <UserAvatar
            compact
            size="xs"
            displayName={assignee.name}
            ariaLabel={assignee.name}
            color={avatarColorForUserId(assignee.id)}
            className={cn(assignee.access === "none" && "tasks-assignee--no-access")}
          />
        </span>
      ))}
      {more > 0 ? (
        <span
          className="tasks-assignee-avatars__more"
          title={assignees
            .slice(max)
            .map((assignee) => assignee.name)
            .join(", ")}
        >
          {moreLabel(more)}
        </span>
      ) : null}
    </span>
  );
}

/** Loads the list audience for the picker; nothing for a list the person cannot write. */
function useListMembers(
  listId: string,
  load: ((listId: string) => Promise<TaskListMembersResult>) | undefined,
): TaskAssigneeMembersState {
  const [state, setState] = useState<TaskAssigneeMembersState>({ status: "loading" });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setState({ status: "loading" });
    load(listId).then(
      (result) => {
        if (!live) return;
        setState(
          result.members
            ? { status: "ready", members: result.members }
            : { status: result.fromCache ? "offline" : "error" },
        );
      },
      () => {
        if (live) setState({ status: "error" });
      },
    );
    return () => {
      live = false;
    };
  }, [listId, load]);
  return load ? state : { status: "error" };
}

export type TasksAssigneesFieldProps = {
  L: TasksUILabels;
  listId: string;
  participants: Task["participants"];
  disabled: boolean;
  /** The list audience (online, else the cached copy). Absent for a reader. */
  loadMembers?: (listId: string) => Promise<TaskListMembersResult>;
  /** The signed-in username: that person reads "(Me)". */
  viewerUsername?: string;
  onChange: (participants: Task["participants"]) => void;
};

/**
 * The Assignee value in the task detail (#2172): "Unassigned", one person's avatar
 * and name, or stacked avatars and "{N} people". It opens the picker.
 */
export function TasksAssigneesField({
  L,
  listId,
  participants,
  disabled,
  loadMembers,
  viewerUsername,
  onChange,
}: TasksAssigneesFieldProps) {
  const [open, setOpen] = useState(false);
  const members = useListMembers(listId, disabled ? undefined : loadMembers);
  const audience = members.status === "ready" ? members.members : null;
  const assignees = useMemo(() => taskAssignees(participants, audience), [participants, audience]);

  const single = assignees.length === 1 ? assignees[0]! : null;
  const label =
    assignees.length === 0
      ? L.assigneeUnassigned
      : single
        ? isViewerParticipant(single.id, viewerUsername)
          ? `${single.name} ${L.assigneeMeTag}`
          : single.name
        : L.assigneePeople(assignees.length);
  const leading =
    assignees.length === 0 ? null : (
      // The names are in the button's name; the initials would only repeat them.
      <span aria-hidden className="contents">
        <TaskAssigneeAvatars assignees={assignees} moreLabel={L.assigneeMore} />
      </span>
    );
  const noAccess = single?.access === "none";

  return (
    <Popover open={disabled ? false : open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <CollectionGhostButton
          className={cn(
            "tasks-field__ghost tasks-assignees-field",
            assignees.length === 0 && "tasks-assignees-field--empty",
            noAccess && "tasks-assignee--no-access",
          )}
          title={noAccess ? L.assigneeNoAccess : undefined}
          disabled={disabled}
          leading={leading}
          // The name comes from the content (WCAG 2.5.3): the field name and, for
          // several people or a lost access, the rest only for screen readers.
          label={
            <>
              <span className="sr-only">{`${L.assigneeLabel}: `}</span>
              {label}
              {assignees.length > 1 ? (
                <span className="sr-only">
                  {` (${assignees.map((assignee) => assignee.name).join(", ")})`}
                </span>
              ) : null}
              {noAccess ? <span className="sr-only">{`, ${L.assigneeNoAccess}`}</span> : null}
            </>
          }
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        frost
        aria-label={L.assigneeLabel}
        className="w-80 p-0"
      >
        <TasksAssigneePicker
          L={L}
          members={members}
          assignees={assignees}
          viewerUsername={viewerUsername}
          onToggleMember={(member: TaskListMember) =>
            onChange(toggleTaskAssignee(participants, member))
          }
          onRemove={(id) => onChange(removeTaskParticipant(participants, id))}
        />
      </PopoverContent>
    </Popover>
  );
}
