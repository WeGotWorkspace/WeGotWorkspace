import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check, Search } from "lucide-react";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import type { TaskListMember } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  isViewerParticipant,
  memberParticipantId,
  type TaskAssignee,
} from "@/tasks-core/src/tasks-assignees";
import { cn } from "@/lib/utils";

/** Where the list audience stands: loading, loaded, or why it is missing. */
export type TaskAssigneeMembersState =
  | { status: "loading" }
  | { status: "ready"; members: TaskListMember[] }
  | { status: "offline" }
  | { status: "error" };

type PickerRow = {
  id: string;
  name: string;
  email: string | null;
  selected: boolean;
  disabled: boolean;
  /** Why the row is dimmed or what it is, under the name. */
  note: string | null;
  member: TaskListMember | null;
};

export type TasksAssigneePickerProps = {
  L: TasksUILabels;
  members: TaskAssigneeMembersState;
  assignees: TaskAssignee[];
  /** The signed-in username: that row reads "(Me)". */
  viewerUsername?: string;
  onToggleMember: (member: TaskListMember) => void;
  /** Unassigns someone the picker cannot list (no access, an outside address). */
  onRemove: (participantId: string) => void;
};

function matches(row: Pick<PickerRow, "name" | "email">, query: string): boolean {
  if (!query) return true;
  return row.name.toLowerCase().includes(query) || (row.email ?? "").toLowerCase().includes(query);
}

function pickerRows(
  L: TasksUILabels,
  members: TaskListMember[],
  assignees: TaskAssignee[],
): PickerRow[] {
  const assigned = new Set(assignees.map((assignee) => assignee.id.toLowerCase()));
  const listed = new Set(members.map(memberParticipantId));
  // Assignees the audience does not hold stay at the top, so they can be removed.
  const outside: PickerRow[] = assignees
    .filter((assignee) => !listed.has(assignee.id.toLowerCase()))
    .map((assignee) => ({
      id: assignee.id,
      name: assignee.name,
      email: assignee.email,
      selected: true,
      disabled: false,
      note: assignee.access === "external" ? L.assigneeExternal : L.assigneeNoAccess,
      member: null,
    }));
  const audience: PickerRow[] = members.map((member) => {
    const id = memberParticipantId(member);
    const selected = assigned.has(id);
    const readOnly = member.access !== "write";
    return {
      id,
      name: member.displayName || member.username,
      email: member.email,
      selected,
      // Someone who can only view the list cannot be assigned; one already assigned
      // can still be removed.
      disabled: readOnly && !selected,
      note: readOnly ? L.assigneeReadOnly : member.email,
      member,
    };
  });
  return [...outside, ...audience];
}

/**
 * The assignee picker (#2172): a search box over the list audience. Arrow keys move
 * through the people, Enter or Space toggles one, and the focus stays in the box.
 */
export function TasksAssigneePicker({
  L,
  members,
  assignees,
  viewerUsername,
  onToggleMember,
  onRemove,
}: TasksAssigneePickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const listId = useId();

  const rows = useMemo(() => {
    if (members.status !== "ready") return [];
    const needle = query.trim().toLowerCase();
    return pickerRows(L, members.members, assignees).filter((row) => matches(row, needle));
  }, [L, assignees, members, query]);

  const active = rows[Math.min(activeIndex, rows.length - 1)];
  const optionId = (index: number) => `${listId}-option-${index}`;

  const toggle = (row: PickerRow) => {
    if (row.disabled) return;
    if (row.member) onToggleMember(row.member);
    else onRemove(row.id);
    setAnnouncement(`${row.name}: ${row.selected ? L.assigneeUnassigned : L.assigneeLabel}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (index) => (Math.min(index, rows.length - 1) + step + rows.length) % rows.length,
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : rows.length - 1);
    } else if (event.key === "Enter" || (event.key === " " && query === "")) {
      event.preventDefault();
      if (active) toggle(active);
    }
  };

  const status =
    members.status === "loading"
      ? L.assigneeLoading
      : members.status === "offline"
        ? L.assigneeConnect
        : members.status === "error"
          ? L.assigneeLoadFailed
          : rows.length === 0
            ? L.assigneeNoMatches
            : null;

  return (
    <div className="tasks-assignee-picker">
      <label className="tasks-assignee-picker__search">
        <Search aria-hidden className="tasks-assignee-picker__search-icon" />
        <span className="sr-only">{L.assigneeSearch}</span>
        <input
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(rows.indexOf(active)) : undefined}
          className="tasks-assignee-picker__input input__field"
          placeholder={L.assigneeSearch}
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <ul
        id={listId}
        role="listbox"
        aria-multiselectable
        aria-label={L.assigneeLabel}
        className="tasks-assignee-picker__list"
      >
        {rows.map((row, index) => (
          <li
            key={row.id}
            id={optionId(index)}
            role="option"
            aria-selected={row.selected}
            aria-disabled={row.disabled || undefined}
            data-active={row === active || undefined}
            className={cn(
              "tasks-assignee-picker__option",
              row.disabled && "tasks-assignee-picker__option--disabled",
              !row.member && "tasks-assignee-picker__option--outside",
            )}
            // Keep the focus in the search box.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => toggle(row)}
          >
            <UserAvatar
              displayName={row.name}
              subtitle={row.note ?? undefined}
              nameAccessory={
                isViewerParticipant(row.id, viewerUsername) ? (
                  <span className="tasks-assignee-picker__me">{L.assigneeMeTag}</span>
                ) : undefined
              }
              size="sm"
              color={avatarColorForUserId(row.id)}
              className="tasks-assignee-picker__person"
            />
            <Check
              aria-hidden
              className="tasks-assignee-picker__check"
              data-checked={row.selected || undefined}
            />
          </li>
        ))}
      </ul>
      {status ? <p className="tasks-assignee-picker__status">{status}</p> : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
