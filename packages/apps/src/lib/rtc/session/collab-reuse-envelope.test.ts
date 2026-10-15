import { describe, expect, it } from "vitest";
import {
  attachReusePayload,
  parseCollabReuseEnvelope,
  serializeCollabReuseEnvelope,
} from "@/lib/rtc/session/collab-reuse-envelope";

describe("collab-reuse envelope", () => {
  it("round-trips open, ack, close, and data envelopes", () => {
    const open = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "open" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      name: "Admin",
    };
    const ack = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "ack" as const,
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    };
    const close = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "close" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
    };
    const data = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "data" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      payload: { type: "sync", bin: 1 },
    };

    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(open))).toEqual(open);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(ack))).toEqual(ack);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(close))).toEqual(close);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(data))).toEqual(data);
  });

  it("passes a non-empty ticket through and drops an empty one", () => {
    const open = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "open" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      name: "Admin",
      ticket: "header.signature",
    };
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(open))).toEqual(open);
    const emptied = parseCollabReuseEnvelope(JSON.stringify({ ...open, ticket: "" }));
    expect(emptied?.ticket).toBeUndefined();
    const numeric = parseCollabReuseEnvelope(JSON.stringify({ ...open, ticket: 4 }));
    expect(numeric?.ticket).toBeUndefined();
  });

  it("rejects malformed payloads and presence envelopes", () => {
    expect(parseCollabReuseEnvelope("not json")).toBeNull();
    expect(parseCollabReuseEnvelope("42")).toBeNull();
    expect(
      parseCollabReuseEnvelope(JSON.stringify({ v: 1, kind: "presence", status: "online" })),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 2, kind: "collab-reuse", room: "x", op: "open" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "", op: "open" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "x", op: "nope" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "x", op: "data" }),
      ),
    ).toBeNull();
  });

  it("puts the frame tail on the nested payload and leaves the envelope unmarked", () => {
    const envelope = parseCollabReuseEnvelope(
      JSON.stringify({
        v: 1,
        kind: "collab-reuse",
        room: "/doc.md",
        op: "data",
        payload: { type: "sync", bin: 1 },
      }),
    );
    expect(envelope).not.toBeNull();
    const attached = attachReusePayload(envelope!, Uint8Array.of(4, 5));
    expect(attached).not.toHaveProperty("bin");
    expect(attached.payload).toEqual({ type: "sync", u: Uint8Array.of(4, 5) });
    expect(attachReusePayload(envelope!, null).payload).toEqual({
      type: "sync",
      u: new Uint8Array(0),
    });
  });
});
