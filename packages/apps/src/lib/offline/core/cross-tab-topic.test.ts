import { describe, expect, it, vi } from "vitest";
import { crossTabTopic } from "./cross-tab-topic";

type Ping = { id: string };
const isPing = (value: unknown): value is Ping => typeof (value as Ping | null)?.id === "string";

/** Another tab: its own channel on the same name. */
function otherTab(name: string) {
  const channel = new BroadcastChannel(name);
  const heard: unknown[] = [];
  channel.onmessage = (event) => heard.push(event.data);
  return { channel, heard };
}

const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("crossTabTopic", () => {
  it("reaches this tab at once and other tabs through the channel", async () => {
    const topic = crossTabTopic("test-topic-a", isPing);
    const here = vi.fn();
    topic.subscribe(here);
    const tab = otherTab("test-topic-a");

    topic.publish({ id: "1" });
    expect(here).toHaveBeenCalledWith({ id: "1" });
    await delivered();
    expect(tab.heard).toEqual([{ id: "1" }]);
    tab.channel.close();
  });

  it("hears other tabs, and drops what is not its message", async () => {
    const topic = crossTabTopic("test-topic-b", isPing);
    const here = vi.fn();
    topic.subscribe(here);
    const tab = otherTab("test-topic-b");

    tab.channel.postMessage({ nope: true });
    tab.channel.postMessage({ id: "2" });
    await delivered();
    expect(here.mock.calls).toEqual([[{ id: "2" }]]);
    tab.channel.close();
  });

  it("can skip this tab when the caller already updated it", async () => {
    const topic = crossTabTopic("test-topic-c", isPing);
    const here = vi.fn();
    topic.subscribe(here);
    const tab = otherTab("test-topic-c");

    topic.publish({ id: "3" }, { otherTabsOnly: true });
    await delivered();
    expect(here).not.toHaveBeenCalled();
    expect(tab.heard).toEqual([{ id: "3" }]);
    tab.channel.close();
  });
});
