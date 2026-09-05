import { describe, expect, it } from "vitest";
import {
  parsePresenceEnvelope,
  serializePresenceEnvelope,
} from "@/presence-core/src/presence-envelope";

describe("presence envelope", () => {
  it("round-trips presence, chat, and typing envelopes", () => {
    const presence = { v: 1, kind: "presence", status: "away" } as const;
    const chat = { v: 1, kind: "chat", id: "alice:1", body: "hi", ts: 123 } as const;
    const typing = { v: 1, kind: "typing" } as const;

    expect(parsePresenceEnvelope(serializePresenceEnvelope(presence))).toEqual(presence);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(chat))).toEqual(chat);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(typing))).toEqual(typing);
  });

  it("round-trips channel-scoped typing envelopes", () => {
    const channelTyping = { v: 1, kind: "typing", channel: "channel-general" } as const;
    const channelStop = { v: 1, kind: "typing", channel: "channel-general", stop: true } as const;

    expect(parsePresenceEnvelope(serializePresenceEnvelope(channelTyping))).toEqual(channelTyping);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(channelStop))).toEqual(channelStop);
  });

  it("rejects invalid channel typing payloads and drops non-true stop flags", () => {
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: "" }))).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: 7 }))).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: "c1", stop: "yes" })),
    ).toEqual({ v: 1, kind: "typing", channel: "c1" });
  });

  it("rejects malformed payloads", () => {
    expect(parsePresenceEnvelope("not json")).toBeNull();
    expect(parsePresenceEnvelope("42")).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 2, kind: "typing" }))).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "unknown" }))).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "presence", status: "busy" })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "", body: "hi", ts: 1 })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "x", body: "  ", ts: 1 })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "x", body: "hi", ts: "1" })),
    ).toBeNull();
  });

  it("round-trips channel-message and call-active envelopes", () => {
    const message = {
      v: 1,
      kind: "channel-message" as const,
      message: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        channelId: "dm:bob",
        authorId: "alice",
        authorName: "Alice",
        body: "hello",
        createdAt: 1_700_000_000_000,
        parentId: null,
      },
    };
    const call = { v: 1, kind: "call-active" as const, channel: "chat-general", active: true };

    expect(parsePresenceEnvelope(serializePresenceEnvelope(message))).toEqual(message);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(call))).toEqual(call);
  });

  it("round-trips Meet patch, destroy, reaction, and channel-changed envelopes", () => {
    const patch = {
      v: 1,
      kind: "channel-message-patch" as const,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      channel: "chat-general",
      body: "edited",
      editedAt: 1_700_000_000_100,
    };
    const destroy = {
      v: 1,
      kind: "channel-message-destroy" as const,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      channel: "chat-general",
    };
    const reaction = {
      v: 1,
      kind: "channel-reaction" as const,
      messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      channel: "dm:bob",
      emoji: "👍",
      on: true,
    };
    const changed = { v: 1, kind: "channel-changed" as const, channel: "chat-general" };

    expect(parsePresenceEnvelope(serializePresenceEnvelope(patch))).toEqual(patch);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(destroy))).toEqual(destroy);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(reaction))).toEqual(reaction);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(changed))).toEqual(changed);
  });

  it("rejects malformed channel-message and call-active payloads", () => {
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "channel-message", message: {} })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(
        JSON.stringify({ v: 1, kind: "call-active", channel: "", active: true }),
      ),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(
        JSON.stringify({ v: 1, kind: "call-active", channel: "c1", active: "yes" }),
      ),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(
        JSON.stringify({
          v: 1,
          kind: "channel-message-patch",
          id: "x",
          channel: "c1",
          body: "  ",
          editedAt: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(
        JSON.stringify({
          v: 1,
          kind: "channel-reaction",
          messageId: "x",
          channel: "c1",
          emoji: "👍",
        }),
      ),
    ).toBeNull();
  });

  it("caps oversized chat bodies", () => {
    const parsed = parsePresenceEnvelope(
      JSON.stringify({ v: 1, kind: "chat", id: "x", body: "a".repeat(5000), ts: 1 }),
    );
    expect(parsed).not.toBeNull();
    if (parsed?.kind === "chat") {
      expect(parsed.body).toHaveLength(4000);
    }
  });
});
