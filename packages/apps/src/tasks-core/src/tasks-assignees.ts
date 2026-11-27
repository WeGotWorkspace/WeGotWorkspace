import type { Task, TaskListMember } from "@/lib/models/tasks-types";

/** A task's participants map, as the API sends it. */
export type TaskParticipants = NonNullable<Task["participants"]>;
type TaskParticipant = TaskParticipants[string];

/** Whether an assignee can still be assigned in the task's list (#2172). */
export type TaskAssigneeAccess = "write" | "read" | "none" | "external" | "unknown";

export type TaskAssignee = {
  /** The participant id: `u:<username>` or `e:<email>`. */
  id: string;
  name: string;
  email: string | null;
  access: TaskAssigneeAccess;
};

/** The participant id the server uses for a person in the list audience. */
export function memberParticipantId(member: Pick<TaskListMember, "username">): string {
  return `u:${member.username.toLowerCase()}`;
}

function isAssigneeEntry(id: string, participant: TaskParticipant | null | undefined): boolean {
  if (!participant || id === "org") return false;
  return (participant.roles ?? []).includes("attendee");
}

/**
 * The people a task is assigned to, in the order the task lists them. `members` is
 * the list audience when known: a `u:` person missing from it shows as "no access",
 * and without it every person's access is "unknown".
 */
export function taskAssignees(
  participants: Task["participants"],
  members: readonly TaskListMember[] | null = null,
): TaskAssignee[] {
  const byId = new Map((members ?? []).map((member) => [memberParticipantId(member), member]));
  const assignees: TaskAssignee[] = [];
  for (const [id, participant] of Object.entries(participants ?? {})) {
    if (!isAssigneeEntry(id, participant)) continue;
    const key = id.toLowerCase();
    const member = byId.get(key);
    // The audience is the account's own profile: it wins over what the line says,
    // so a CalDAV client cannot show one person under another's name.
    const email = member?.email || participant!.email?.trim() || null;
    const access: TaskAssigneeAccess = !key.startsWith("u:")
      ? "external"
      : members === null
        ? "unknown"
        : (member?.access ?? "none");
    const name =
      member?.displayName ||
      participant!.name?.trim() ||
      email ||
      participant!.username ||
      id.replace(/^[ue]:/, "");
    assignees.push({ id, name, email, access });
  }
  return assignees;
}

/** The entry a new assignee gets; the server fills the name and address for `u:` ids. */
export function assigneeParticipant(member: TaskListMember): TaskParticipant {
  return {
    "@type": "Participant",
    name: member.displayName,
    email: member.email,
    roles: ["attendee"],
    participationStatus: "needs-action",
  };
}

/** `participants` with `member` added, or removed when already assigned. */
export function toggleTaskAssignee(
  participants: Task["participants"],
  member: TaskListMember,
): TaskParticipants | undefined {
  const id = memberParticipantId(member);
  const existing = Object.keys(participants ?? {}).find((key) => key.toLowerCase() === id);
  const next: TaskParticipants = { ...participants };
  if (existing) delete next[existing];
  else next[id] = assigneeParticipant(member);
  return Object.keys(next).length > 0 ? next : undefined;
}

/** `participants` without the participant `id` (an assignee who is not in the audience). */
export function removeTaskParticipant(
  participants: Task["participants"],
  id: string,
): TaskParticipants | undefined {
  const next: TaskParticipants = { ...participants };
  delete next[id];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The per-id merge patch from `before` to `after`: changed or added entries as
 * they are, removed ones as `null`. `undefined` when nothing changed.
 */
export function taskParticipantsPatch(
  before: Task["participants"],
  after: Task["participants"],
): Record<string, TaskParticipant | null> | undefined {
  const patch: Record<string, TaskParticipant | null> = {};
  for (const id of Object.keys(before ?? {})) {
    if (!(id in (after ?? {}))) patch[id] = null;
  }
  for (const [id, participant] of Object.entries(after ?? {})) {
    if (JSON.stringify(before?.[id]) !== JSON.stringify(participant)) patch[id] = participant;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export type TaskAssigneePerson = { username: string; name: string };

/**
 * The colleagues the given tasks are assigned to, by name: the people for the sidebar's
 * "Assigned to" section. The tasks are the ones the viewer can see, so only shared work
 * counts. The viewer (`Me`) and people outside the system (`e:` attendees) are left out.
 */
export function assigneePeopleOfTasks(
  tasks: readonly Pick<Task, "participants">[],
  viewerUsername: string | null | undefined,
): TaskAssigneePerson[] {
  const me = viewerUsername?.trim().toLowerCase();
  const byUsername = new Map<string, TaskAssigneePerson>();
  for (const task of tasks) {
    for (const assignee of taskAssignees(task.participants)) {
      if (!assignee.id.toLowerCase().startsWith("u:")) continue;
      const username = assignee.id.slice(2);
      const key = username.toLowerCase();
      if (key === me || byUsername.has(key)) continue;
      byUsername.set(key, { username, name: assignee.name });
    }
  }
  return [...byUsername.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the participant id (`u:<username>`) is the signed-in person. */
export function isViewerParticipant(
  participantId: string,
  viewerUsername: string | null | undefined,
): boolean {
  const me = viewerUsername?.trim().toLowerCase();
  return Boolean(me) && participantId.toLowerCase() === `u:${me}`;
}
