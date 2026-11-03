import { describe, expect, it, vi } from "vitest";
import {
  notifyNotesBootstrapUpdated,
  subscribeNotesBootstrapUpdated,
} from "@/lib/offline/notes-bootstrap-sync";

const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("notes-bootstrap-sync", () => {
  it("hears another tab's update for the same account only", async () => {
    const onUpdate = vi.fn();
    const stop = subscribeNotesBootstrapUpdated("alice", onUpdate);
    const otherTab = new BroadcastChannel("wgw.notes.bootstrap");

    otherTab.postMessage({ type: "notes-bootstrap-updated", username: "bob" });
    otherTab.postMessage({ type: "notes-bootstrap-updated", username: "alice" });
    await delivered();

    expect(onUpdate).toHaveBeenCalledOnce();
    stop();
    otherTab.close();
  });

  it("tells other tabs, not this one", async () => {
    const onUpdate = vi.fn();
    const stop = subscribeNotesBootstrapUpdated("alice", onUpdate);
    const otherTab = new BroadcastChannel("wgw.notes.bootstrap");
    const heard: unknown[] = [];
    otherTab.onmessage = (event) => heard.push(event.data);

    notifyNotesBootstrapUpdated("alice");
    await delivered();

    expect(onUpdate).not.toHaveBeenCalled();
    expect(heard).toEqual([{ type: "notes-bootstrap-updated", username: "alice" }]);
    stop();
    otherTab.close();
  });
});
