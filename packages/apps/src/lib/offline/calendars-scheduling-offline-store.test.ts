import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import {
  readCalendarInviteesDirectory,
  readCalendarSchedulingInbox,
  writeCalendarInviteesDirectory,
  writeCalendarSchedulingInbox,
} from "@/lib/offline/calendars-scheduling-offline-store";

const username = "alice";

describe("calendars scheduling offline store", () => {
  beforeEach(async () => {
    await writeCalendarSchedulingInbox(username, []);
    await writeCalendarInviteesDirectory(username, { list: [], canSubmitEmail: false });
  });

  it("allocates the scheduling Dexie step after groups", () => {
    expect(CALENDARS_OFFLINE_VERSION.groups).toBe(51);
    expect(CALENDARS_OFFLINE_VERSION.scheduling).toBe(52);
  });

  it("restores the inbox and invitee directory after reload", async () => {
    await writeCalendarSchedulingInbox(username, [
      {
        id: "invite-1.ics",
        uid: "uid-1",
        method: "REQUEST",
        title: "Standup",
        organizerEmail: "bob@example.test",
        participationStatus: "needs-action",
      },
    ]);
    await writeCalendarInviteesDirectory(username, {
      list: [{ username: "bob", email: "bob@example.test", name: "Bob" }],
      canSubmitEmail: true,
    });

    await expect(readCalendarSchedulingInbox(username)).resolves.toEqual([
      expect.objectContaining({ id: "invite-1.ics", title: "Standup" }),
    ]);
    await expect(readCalendarInviteesDirectory(username)).resolves.toEqual({
      list: [{ username: "bob", email: "bob@example.test", name: "Bob" }],
      canSubmitEmail: true,
    });
  });
});
