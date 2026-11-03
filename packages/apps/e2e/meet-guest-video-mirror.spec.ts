import { expect, test, type Locator, type Page } from "./helpers/live-test";
import {
  admitFirstKnocker,
  createAdHocRoom,
  holdRoomOffers,
  joinMeetRoom,
  knockAsGuest,
  meetLobby,
  openGuest,
  openSignedInHost,
  waitForInCall,
} from "./helpers/meet-guest-chat";

const GUEST = "Ada";
const MIRRORED = "matrix(-1, 0, 0, 1, 0, 0)";

/**
 * Issue #1216: only your own camera preview is mirrored. The other person's
 * camera, guest or signed-in member, is shown the right way round.
 */
test("only the local camera is mirrored in a member and guest call", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await openSignedInHost(browser);
  const guest = await openGuest(browser);
  const hostOffers = await holdRoomOffers(host.context);
  const guestOffers = await holdRoomOffers(guest.context);

  try {
    if (!host.accessToken) throw new Error("Host login did not return a token.");
    const room = await createAdHocRoom(host.page, host.accessToken);
    await joinMeetRoom(host.page, room);
    await waitForInCall(host.page);
    await knockAsGuest(guest.page, room, GUEST);
    await expect(meetLobby(host.page)).toBeVisible();
    await admitFirstKnocker(host.page);
    await waitForInCall(guest.page);
    hostOffers.release();
    guestOffers.release();

    // The member sees the guest's camera the right way round.
    const guestOnHost = videoOf(host.page, GUEST);
    await expectPlaying(guestOnHost);
    expect(await transformOf(guestOnHost)).not.toBe(MIRRORED);
    expect(await transformOf(videoExcept(host.page, GUEST))).toBe(MIRRORED);

    // The guest sees the member's camera the right way round.
    const hostOnGuest = videoExcept(guest.page, GUEST);
    await expectPlaying(hostOnGuest);
    expect(await transformOf(hostOnGuest)).not.toBe(MIRRORED);
    expect(await transformOf(videoOf(guest.page, GUEST))).toBe(MIRRORED);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

function nameOf(page: Page, name: string): Locator {
  return page.locator(".meet-peer-tile__name", { hasText: name });
}

/** Camera video in the tile named `name`. */
function videoOf(page: Page, name: string): Locator {
  return page
    .locator(".meet-peer-tile")
    .filter({ has: nameOf(page, name) })
    .locator("video.meet-stream-video")
    .first();
}

/** Camera video in the one tile that is not named `name`. */
function videoExcept(page: Page, name: string): Locator {
  return page
    .locator(".meet-peer-tile")
    .filter({ hasNot: nameOf(page, name) })
    .locator("video.meet-stream-video")
    .first();
}

async function expectPlaying(video: Locator): Promise<void> {
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth), { timeout: 45_000 })
    .toBeGreaterThan(0);
}

async function transformOf(video: Locator): Promise<string> {
  await expect(video).toBeAttached();
  return video.evaluate((node) => getComputedStyle(node).transform);
}
