import { expect, test } from "@playwright/test";
import {
  admitFirstKnocker,
  armGuestChatArrival,
  blockMeetDataChannel,
  chatArrivedAt,
  chatBodyCount,
  chatSentAt,
  createAdHocRoom,
  holdRoomOffers,
  joinMeetRoom,
  knockAsGuest,
  meetDcOpenCount,
  openGuest,
  openSignedInHost,
  trackRoomMessagePosts,
  typeCallChat,
  waitForInCall,
} from "./helpers/meet-guest-chat";

/**
 * Issue #1081: guest chat is under 300 ms while the Meet data channel is open,
 * and arrives exactly once over HTTP when that channel is blocked.
 */
test("guest chat is under 300ms on an open channel and once over HTTP when blocked", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fastText = `dc-${uniqueId()}`;
  const httpText = `http-${uniqueId()}`;
  const host = await openSignedInHost(browser);
  const guest = await openGuest(browser);
  const hostOffers = await holdRoomOffers(host.context);
  const guestOffers = await holdRoomOffers(guest.context);

  try {
    if (!host.accessToken) throw new Error("Host login did not return a token.");
    const room = await createAdHocRoom(host.page, host.accessToken);
    await joinMeetRoom(host.page, room);
    await waitForInCall(host.page);
    await knockAsGuest(guest.page, room, "Ada");
    await expect(host.page.getByRole("button", { name: /waiting to join/ })).toBeVisible();
    await admitFirstKnocker(host.page);
    await waitForInCall(guest.page);
    hostOffers.release();
    guestOffers.release();

    await expect.poll(() => meetDcOpenCount(host.page), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => meetDcOpenCount(guest.page), { timeout: 45_000 }).toBeGreaterThan(0);

    await typeCallChat(host.page, fastText);
    await armGuestChatArrival(guest.page, fastText);
    await host.page.keyboard.press("Enter");
    const sentAt = await chatSentAt(host.page);
    expect(sentAt).toBeGreaterThan(0);
    await expect
      .poll(() => chatArrivedAt(guest.page), { timeout: 1_000, intervals: [16, 32, 64] })
      .toBeGreaterThan(0);
    const arrivedAt = await chatArrivedAt(guest.page);
    expect(arrivedAt - sentAt).toBeLessThan(300);
    expect(await chatBodyCount(guest.page, fastText)).toBe(1);

    const httpPosts = trackRoomMessagePosts(host.page, room, httpText);
    await blockMeetDataChannel(host.page);
    await blockMeetDataChannel(guest.page);
    await expect.poll(() => meetDcOpenCount(host.page)).toBe(0);
    await expect.poll(() => meetDcOpenCount(guest.page)).toBe(0);

    await typeCallChat(host.page, httpText);
    await armGuestChatArrival(guest.page, httpText);
    await host.page.keyboard.press("Enter");
    await expect.poll(() => httpPosts.count(), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => chatBodyCount(guest.page, httpText), { timeout: 15_000 }).toBe(1);
    await guest.page.waitForTimeout(5_000);
    expect(httpPosts.count()).toBe(1);
    expect(await chatBodyCount(guest.page, httpText)).toBe(1);
    expect(await chatBodyCount(guest.page, fastText)).toBe(1);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
