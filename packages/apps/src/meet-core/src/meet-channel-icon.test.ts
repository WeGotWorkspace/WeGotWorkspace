import { CalendarDays, Hash, Users } from "lucide-react";
import { describe, expect, it } from "vitest";
import { meetChannelIcon } from "@/meet-core/src/meet-channel-icon";
import type { MeetChannel } from "@/lib/models/meet-types";

const base: MeetChannel = { id: "c", name: "x", kind: "channel", scope: "personal" };

describe("meetChannelIcon", () => {
  it("maps each conversation kind to one icon", () => {
    expect(meetChannelIcon({ ...base, kind: "meeting" })).toBe(CalendarDays);
    expect(meetChannelIcon({ ...base, scope: "group", groupSlug: "t", projectId: "p" })).toBe(Hash);
    expect(meetChannelIcon({ ...base, scope: "group", groupSlug: "t" })).toBe(Users);
    expect(meetChannelIcon(base)).toBe(Hash);
  });
});
