import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * Opus DTX on a real call (#1626). A muted participant must send audio at a
 * DTX rate (well under the 50 packets/s of full-rate Opus) while the other side
 * still receives audio. Peer ids are random, so each side is the muted sender
 * once; that covers the munged offer and the munged answer.
 */

const WINDOW_MS = 5_000;
const MAX_DTX_PACKETS_PER_SECOND = 30;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a muted participant sends audio at a DTX rate and the peer still receives audio", async ({
  browser,
}) => {
  const channelId = await setUp(`e2e-dtx-${Date.now().toString(36)}`);
  const contexts: BrowserContext[] = [];

  try {
    const starter = await openTapped(browser, OWNER, channelId, contexts);
    const joiner = await openTapped(browser, TEAMMATE, channelId, contexts);

    await starter.getByRole("button", { name: "More call options" }).click();
    await starter.getByRole("menuitem", { name: "Meet (Audio Only)" }).click();
    await expect(starter.getByRole("button", { name: "Enable video" })).toBeVisible();

    await joiner.getByRole("button", { name: "Join", exact: true }).click();
    await expect.poll(() => mediaLinkUp(joiner), { timeout: 45_000 }).toBe(true);
    await expect.poll(() => mediaLinkUp(starter), { timeout: 45_000 }).toBe(true);

    for (const [muted, listener] of [
      [starter, joiner],
      [joiner, starter],
    ] as const) {
      await muted.getByRole("button", { name: "Disable audio" }).click();
      await expect(muted.getByRole("button", { name: "Enable audio" })).toBeVisible();

      const sentBefore = await audioPackets(muted, "outbound-rtp", "packetsSent");
      const receivedBefore = await audioPackets(listener, "inbound-rtp", "bytesReceived");
      await muted.waitForTimeout(WINDOW_MS);
      const sent = (await audioPackets(muted, "outbound-rtp", "packetsSent")) - sentBefore;
      const received =
        (await audioPackets(listener, "inbound-rtp", "bytesReceived")) - receivedBefore;

      const rate = sent / (WINDOW_MS / 1_000);
      expect(rate, "muted sender still sends audio").toBeGreaterThan(0);
      expect(rate, "muted sender sends at a DTX rate").toBeLessThan(MAX_DTX_PACKETS_PER_SECOND);
      expect(received, "the peer still receives audio bytes").toBeGreaterThan(0);

      await muted.getByRole("button", { name: "Enable audio" }).click();
      await expect(muted.getByRole("button", { name: "Disable audio" })).toBeVisible();
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

/** A fresh Team of owner + teammate, and a channel in it. */
async function setUp(group: string): Promise<string> {
  const steps = [
    ["POST", "/admin/groups", { slug: group, displayName: group }],
    ["PUT", `/admin/groups/${group}/members/${OWNER}`, undefined],
    ["PUT", `/admin/groups/${group}/members/${TEAMMATE}`, undefined],
  ] as const;
  for (const [method, path, body] of steps) {
    const res = await api(OWNER, method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path} ${res.status}`);
  }
  const created = await api(OWNER, "POST", "/chat/channels", {
    name: group,
    kind: "channel",
    groupSlug: group,
  });
  if (created.status !== 201) throw new Error(`Create channel ${created.status}`);
  return (created.json as { id: string }).id;
}

/** A signed-in tab with camera access that keeps every peer connection it opens. */
async function openTapped(
  browser: Parameters<typeof openUser>[0],
  user: string,
  channelId: string,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await openUser(browser, user);
  contexts.push(context);
  await context.grantPermissions(["camera", "microphone"]);
  await context.addInitScript(tapPeerConnections);
  const tab = await context.newPage();
  await tab.goto(`/meet/channels/${channelId}`);
  return tab;
}

function tapPeerConnections(): void {
  const connections: RTCPeerConnection[] = [];
  (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = connections;
  const Native = window.RTCPeerConnection;
  const Tapped = function (this: unknown, ...args: ConstructorParameters<typeof Native>) {
    const connection = new Native(...args);
    connections.push(connection);
    return connection;
  } as unknown as typeof RTCPeerConnection;
  Tapped.prototype = Native.prototype;
  Object.setPrototypeOf(Tapped, Native);
  window.RTCPeerConnection = Tapped;
}

/** Peer connections that carry media (the presence mesh is data only). */
function mediaConnections(): RTCPeerConnection[] {
  const all = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
  return all.filter(
    (pc) =>
      pc.connectionState !== "closed" &&
      pc.getTransceivers().some((t) => t.receiver.track?.kind === "video"),
  );
}

async function mediaLinkUp(page: Page): Promise<boolean> {
  return page.evaluate(
    `(${mediaConnections.toString()})().some((pc) => pc.connectionState === "connected")`,
  );
}

/** Sum of one audio RTP stat over the media connections of this tab. */
async function audioPackets(
  page: Page,
  type: "outbound-rtp" | "inbound-rtp",
  field: "packetsSent" | "bytesReceived",
): Promise<number> {
  return page.evaluate(`(async () => {
    let total = 0;
    for (const pc of (${mediaConnections.toString()})()) {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "${type}" && report.kind === "audio") total += report["${field}"] ?? 0;
      });
    }
    return total;
  })()`) as Promise<number>;
}
