import { describe, expect, it } from "vitest";
import { createMeetTypingHeartbeat } from "@/meet-core/src/meet-typing-heartbeat";

function setup(heartbeatMs = 4000) {
  const sent: string[] = [];
  const stopped: string[] = [];
  let nowValue = 1000;
  const heartbeat = createMeetTypingHeartbeat({
    send: (channelId) => sent.push(channelId),
    sendStop: (channelId) => stopped.push(channelId),
    heartbeatMs,
    now: () => nowValue,
  });
  return { heartbeat, sent, stopped, advance: (ms: number) => (nowValue += ms) };
}

describe("createMeetTypingHeartbeat", () => {
  it("broadcasts immediately on the first keystroke", () => {
    const { heartbeat, sent } = setup();
    heartbeat.keystroke("channel-1");
    expect(sent).toEqual(["channel-1"]);
  });

  it("throttles continued typing to one broadcast per heartbeat window", () => {
    const { heartbeat, sent, advance } = setup(4000);
    heartbeat.keystroke("channel-1");
    advance(1000);
    heartbeat.keystroke("channel-1");
    advance(1000);
    heartbeat.keystroke("channel-1");
    expect(sent).toEqual(["channel-1"]);

    advance(2000); // 4000ms since the first send
    heartbeat.keystroke("channel-1");
    expect(sent).toEqual(["channel-1", "channel-1"]);
  });

  it("stop retracts the active channel and re-arms the immediate send", () => {
    const { heartbeat, sent, stopped, advance } = setup(4000);
    heartbeat.keystroke("channel-1");
    heartbeat.stop();
    expect(stopped).toEqual(["channel-1"]);

    advance(100); // well inside the old window
    heartbeat.keystroke("channel-1");
    expect(sent).toEqual(["channel-1", "channel-1"]);
  });

  it("stop without prior keystroke sends nothing", () => {
    const { heartbeat, sent, stopped } = setup();
    heartbeat.stop();
    expect(sent).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it("switching channels retracts the old one and broadcasts the new one immediately", () => {
    const { heartbeat, sent, stopped, advance } = setup(4000);
    heartbeat.keystroke("channel-1");
    advance(500);
    heartbeat.keystroke("channel-2");
    expect(stopped).toEqual(["channel-1"]);
    expect(sent).toEqual(["channel-1", "channel-2"]);
  });

  it("ignores empty channel ids", () => {
    const { heartbeat, sent } = setup();
    heartbeat.keystroke("");
    expect(sent).toEqual([]);
  });
});
