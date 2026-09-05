import { describe, expect, it } from "vitest";
import {
  acceptMeetMeshChannel,
  meetMeshReceiveCallChannelId,
} from "@/meet-core/src/meet-mesh-inbound";

describe("acceptMeetMeshChannel", () => {
  it("accepts DMs without a known collection id", () => {
    expect(acceptMeetMeshChannel("dm:alice", new Set())).toBe(true);
  });

  it("accepts only channels already in the local ACL cache", () => {
    expect(acceptMeetMeshChannel("chat-secret", new Set(["chat-general"]))).toBe(false);
    expect(acceptMeetMeshChannel("chat-general", new Set(["chat-general"]))).toBe(true);
  });
});

describe("meetMeshReceiveCallChannelId", () => {
  it("rewrites virtual DM ids onto the sender", () => {
    expect(meetMeshReceiveCallChannelId("dm:bob", "alice")).toBe("dm:alice");
    expect(meetMeshReceiveCallChannelId("chat-general", "alice")).toBe("chat-general");
  });
});
