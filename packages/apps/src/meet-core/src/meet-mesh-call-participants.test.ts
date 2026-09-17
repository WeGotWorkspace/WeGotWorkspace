import { describe, expect, it } from "vitest";
import {
  applyMeetMeshCallEvent,
  applyMeetMeshCallParticipant,
  meetMeshCallActiveFromParticipants,
} from "@/meet-core/src/meet-mesh-call-participants";
import { meetMeshOnlineTargetKey } from "@/meet-core/src/meet-mesh-call-replay";

describe("applyMeetMeshCallParticipant", () => {
  it("keeps an empty set after the last sender leaves so merge can ignore a stale poll", () => {
    const withBob = applyMeetMeshCallParticipant(
      {},
      { channelId: "chat-general", senderUsername: "bob", active: true },
    );
    expect(withBob).toEqual({ "chat-general": ["bob"] });

    const emptied = applyMeetMeshCallParticipant(withBob, {
      channelId: "chat-general",
      senderUsername: "bob",
      active: false,
    });
    expect(emptied).toEqual({ "chat-general": [] });
    expect(meetMeshCallActiveFromParticipants(emptied)).toEqual({});
  });

  it("does not invent an empty set for a channel mesh has never seen", () => {
    expect(
      applyMeetMeshCallParticipant(
        {},
        { channelId: "chat-general", senderUsername: "bob", active: false },
      ),
    ).toEqual({});
  });
});

describe("applyMeetMeshCallEvent audioOnly", () => {
  const empty = { participants: {}, audioOnly: {} };

  it("records audioOnly on a local start without a sender", () => {
    expect(
      applyMeetMeshCallEvent(empty, { channelId: "chat-general", active: true, audioOnly: true }),
    ).toEqual({ participants: {}, audioOnly: { "chat-general": true } });
  });

  it("records inbound audioOnly and drops it on a later video start", () => {
    const started = applyMeetMeshCallEvent(empty, {
      channelId: "chat-general",
      senderUsername: "bob",
      active: true,
      audioOnly: true,
    });
    expect(started.audioOnly).toEqual({ "chat-general": true });
    expect(
      applyMeetMeshCallEvent(started, {
        channelId: "chat-general",
        senderUsername: "carol",
        active: true,
      }).audioOnly,
    ).toEqual({});
  });
});

describe("meetMeshOnlineTargetKey", () => {
  it("keys only targets that are currently on the roster", () => {
    expect(meetMeshOnlineTargetKey(["bob", "carol"], ["carol", "dave"])).toBe("carol");
    expect(meetMeshOnlineTargetKey(["bob", "carol"], ["carol", "bob"])).toBe("bob\ncarol");
  });
});
