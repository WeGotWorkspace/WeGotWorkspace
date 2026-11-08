import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * A call started with "Meet (Audio Only)" has no camera track at connect time
 * (#1951). Turning the camera on later must reach the other participant, and
 * turning it off must bring the avatar back.
 *
 * Peer ids are random, so the audio-only side is the offering or the answering
 * side of the link at random. Both scenarios record which one it was.
 */

const NAME: Record<string, string> = { [OWNER]: "Admin", [TEAMMATE]: "Member" };

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

for (const [audioOnlyUser, videoUser] of [
  [OWNER, TEAMMATE],
  [TEAMMATE, OWNER],
] as const) {
  test(`${audioOnlyUser} starts audio only, turns the camera on and off, and ${videoUser} sees it`, async ({
    browser,
  }) => {
    const channelId = await setUp(`e2e-camera-${Date.now().toString(36)}`);
    const contexts: BrowserContext[] = [];
    const audioName = NAME[audioOnlyUser]!;

    try {
      const starter = await openTapped(browser, audioOnlyUser, channelId, contexts);
      const joiner = await openTapped(browser, videoUser, channelId, contexts);

      await starter.getByRole("button", { name: "More call options" }).click();
      await starter.getByRole("menuitem", { name: "Meet (Audio Only)" }).click();
      await expect(starter.getByRole("button", { name: "Enable video" })).toBeVisible();

      await joiner.getByRole("button", { name: "Join", exact: true }).click();
      await expect(tile(joiner, audioName)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => mediaLinkUp(joiner), { timeout: 45_000 }).toBe(true);
      test.info().annotations.push({
        type: "audio-only side",
        description: (await offeredFirst(starter)) ? "offerer" : "answerer",
      });

      // Before: the audio-only participant is an avatar on the other side.
      await expect(tile(joiner, audioName).locator(".meet-peer-tile__fill")).toBeVisible();

      await starter.getByRole("button", { name: "Enable video" }).click();
      await expect(starter.getByRole("button", { name: "Disable video" })).toBeVisible();
      await expect.poll(() => tilePlaysVideo(starter, audioName)).toBe(true);
      expect(await localCameraTracks(starter), "one camera track in the local stream").toBe(1);
      await expect
        .poll(() => receivesVideoFrames(joiner), { message: "video frames reach the peer" })
        .toBe(true);
      await expect.poll(() => tilePlaysVideo(joiner, audioName)).toBe(true);

      await starter.getByRole("button", { name: "Disable video" }).click();
      await expect(tile(joiner, audioName).locator(".meet-peer-tile__fill")).toBeVisible();
      expect(await sendsEnabledCamera(starter), "the camera track is switched off").toBe(false);

      // And on again: the same slot carries the camera a second time.
      await starter.getByRole("button", { name: "Enable video" }).click();
      await expect.poll(() => tilePlaysVideo(joiner, audioName)).toBe(true);
      await expect.poll(() => receivesVideoFrames(joiner)).toBe(true);
    } finally {
      for (const context of contexts) await context.close();
    }
  });
}

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

function tile(page: Page, name: string) {
  return page
    .locator(".meet-peer-tile")
    .filter({ has: page.locator(".meet-peer-tile__name", { hasText: name }) })
    .first();
}

/** The tile shows its video (no avatar) and the element is decoding frames. */
async function tilePlaysVideo(page: Page, name: string): Promise<boolean> {
  const target = tile(page, name);
  if ((await target.locator(".meet-peer-tile__fill").count()) > 0) return false;
  const video = target.locator(".meet-peer-tile__media:not(.sr-only) video");
  if ((await video.count()) === 0) return false;
  const frames = () =>
    video.evaluate((node) => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
  const before = await frames();
  await page.waitForTimeout(500);
  const width = await video.evaluate((node) => (node as HTMLVideoElement).videoWidth);
  return width > 0 && (await frames()) > before;
}

/** Camera tracks in the stream the own tile plays (muted: the local preview). */
async function localCameraTracks(page: Page): Promise<number> {
  return page
    .locator(".meet-peer-tile video[muted]")
    .first()
    .evaluate((node) => {
      const stream = (node as HTMLVideoElement).srcObject as MediaStream | null;
      return stream?.getVideoTracks().length ?? 0;
    });
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

async function offeredFirst(page: Page): Promise<boolean> {
  return page.evaluate(
    `(${mediaConnections.toString()})().some((pc) => pc.localDescription?.type === "offer")`,
  );
}

async function sendsEnabledCamera(page: Page): Promise<boolean> {
  return page.evaluate(
    `(${mediaConnections.toString()})().some((pc) => pc.getSenders().some((s) => s.track?.kind === "video" && s.track.enabled))`,
  );
}

/** Inbound video frames decoded on this tab keep rising. */
async function receivesVideoFrames(page: Page): Promise<boolean> {
  const decoded = () =>
    page.evaluate(`(async () => {
      let total = 0;
      for (const pc of (${mediaConnections.toString()})()) {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") total += report.framesDecoded ?? 0;
        });
      }
      return total;
    })()`) as Promise<number>;
  const before = await decoded();
  await page.waitForTimeout(1_000);
  return (await decoded()) > before;
}
