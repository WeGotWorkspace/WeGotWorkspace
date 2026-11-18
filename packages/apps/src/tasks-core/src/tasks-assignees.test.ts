import { describe, expect, it } from "vitest";
import type { Task, TaskListMember } from "@/lib/models/tasks-types";
import {
  assigneeParticipant,
  removeTaskParticipant,
  taskAssignees,
  taskParticipantsPatch,
  toggleTaskAssignee,
} from "@/tasks-core/src/tasks-assignees";

const alex: TaskListMember = {
  username: "alex",
  displayName: "Alex Morgan",
  email: "alex@example.org",
  access: "write",
};
const robin: TaskListMember = { ...alex, username: "robin", displayName: "Robin", access: "read" };

const participants = {
  org: { "@type": "Participant", name: "Owner", roles: ["owner"] },
  "u:alex": { "@type": "Participant", name: "Alex Morgan", roles: ["attendee"] },
  "u:gone": { "@type": "Participant", name: "Casey", roles: ["attendee"] },
  "e:bird@example.org": {
    "@type": "Participant",
    email: "bird@example.org",
    roles: ["attendee"],
  },
} as NonNullable<Task["participants"]>;

describe("taskAssignees", () => {
  it("lists attendees, not the organizer, with their access in the audience", () => {
    expect(taskAssignees(participants, [alex, robin])).toEqual([
      { id: "u:alex", name: "Alex Morgan", email: "alex@example.org", access: "write" },
      { id: "u:gone", name: "Casey", email: null, access: "none" },
      {
        id: "e:bird@example.org",
        name: "bird@example.org",
        email: "bird@example.org",
        access: "external",
      },
    ]);
  });

  it("leaves access unknown without an audience", () => {
    expect(taskAssignees(participants).map((assignee) => assignee.access)).toEqual([
      "unknown",
      "unknown",
      "external",
    ]);
  });
});

describe("assignee edits", () => {
  it("toggles a member on and off, keeping the other participants", () => {
    const added = toggleTaskAssignee({ org: participants.org! }, robin);
    expect(added).toEqual({ org: participants.org, "u:robin": assigneeParticipant(robin) });
    expect(toggleTaskAssignee(added, robin)).toEqual({ org: participants.org });
  });

  it("removes the last participant to undefined", () => {
    expect(removeTaskParticipant({ "u:gone": participants["u:gone"]! }, "u:gone")).toBeUndefined();
  });

  it("patches per id: added entries, removed ones as null, untouched ones left out", () => {
    const after = toggleTaskAssignee(removeTaskParticipant(participants, "u:gone"), robin);
    expect(taskParticipantsPatch(participants, after)).toEqual({
      "u:gone": null,
      "u:robin": assigneeParticipant(robin),
    });
    expect(taskParticipantsPatch(participants, { ...participants })).toBeUndefined();
  });
});
