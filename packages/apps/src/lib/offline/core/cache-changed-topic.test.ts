import { describe, expect, it, vi } from "vitest";
import { cacheChangedTopic } from "./cache-changed-topic";

const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("cacheChangedTopic", () => {
  it("tells the other tabs of the same app, not this one", async () => {
    const topic = cacheChangedTopic("test-app-a");
    const here = vi.fn();
    const stop = topic.subscribe("alice", here);
    const otherTab = new BroadcastChannel("wgw.test-app-a.bootstrap");
    const heard: unknown[] = [];
    otherTab.onmessage = (event) => heard.push(event.data);

    topic.notifyOtherTabs("alice");
    await delivered();

    expect(here).not.toHaveBeenCalled();
    expect(heard).toEqual([{ type: "test-app-a-bootstrap-updated", username: "alice" }]);
    stop();
    otherTab.close();
  });

  it("hears another tab for the same account and app only", async () => {
    const onChange = vi.fn();
    const stop = cacheChangedTopic("test-app-b").subscribe("alice", onChange);
    const otherTab = new BroadcastChannel("wgw.test-app-b.bootstrap");

    otherTab.postMessage({ type: "test-app-b-bootstrap-updated", username: "bob" });
    otherTab.postMessage({ type: "other-app-bootstrap-updated", username: "alice" });
    otherTab.postMessage({ type: "test-app-b-bootstrap-updated", username: "alice" });
    await delivered();

    expect(onChange).toHaveBeenCalledOnce();
    stop();
    otherTab.close();
  });

  it("does nothing without an account", () => {
    const topic = cacheChangedTopic("test-app-c");
    const onChange = vi.fn();
    topic.subscribe("", onChange)();
    expect(() => topic.notifyOtherTabs("")).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
