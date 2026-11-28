import { expect, test, type Page } from "./helpers/live-test";
import {
  admitFirstKnocker,
  createAdHocRoom,
  joinMeetRoom,
  knockAsGuest,
  meetLobby,
  openGuest,
  openSignedInHost,
  waitForInCall,
} from "./helpers/meet-guest-chat";
import { openUser, TEAMMATE } from "./helpers/live-matrix";
import { setRtcTestOverrides } from "./helpers/rtc-test-overrides";
import { TrafficMeter, writeReport } from "./helpers/traffic-meter";

// Report the service worker's own fetches: the Meet polls and doorbell reads
// are answered by the worker, and without this the meter never sees them.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

/**
 * Issue #2419: call setup on the default `shared` traffic numbers. From the
 * host's admit click (the join POST for a member the lobby already knows is
 * not the start: nobody negotiates before the host lets them in) to the first
 * offer or answer POST takes at most 3 s, to the first remote frame at most 8 s, and the browser stays under 60 requests in the
 * minute after its join. Member and guest are measured separately.
 */
const OFFER_MS = 3_000;
const FRAME_MS = 8_000;
const PER_MINUTE = 60;

type Marks = { join: number; admitted: number; signal: number | null };

/** Stamps the join POST and the first offer/answer POST on `/rooms/{id}/events`. */
function markSetup(page: Page, room: string, onJoin: () => void): Marks {
  const marks: Marks = { join: 0, admitted: 0, signal: null };
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const url = request.url();
    if (url.includes(`/rooms/${room}/participants`) && !marks.join) {
      marks.join = Date.now();
      onJoin();
    }
    if (marks.signal === null && url.includes(`/rooms/${room}/events`)) {
      const body = request.postData() ?? "";
      if (/offer|answer/i.test(body)) marks.signal = Date.now();
    }
  });
  return marks;
}

/** Resolves when a video that is not the mirrored local preview has advanced its clock. */
async function firstRemoteFrame(page: Page): Promise<number> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll<HTMLVideoElement>("video")).some(
        (video) =>
          getComputedStyle(video).transform !== "matrix(-1, 0, 0, 1, 0, 0)" &&
          video.videoWidth > 0 &&
          video.currentTime > 0,
      ),
    undefined,
    { timeout: 45_000, polling: 100 },
  );
  return Date.now();
}

async function workerControls(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, {
    timeout: 30_000,
  });
}

test("call setup stays fast and under 60 requests a minute for a member and a guest", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const owner = await openSignedInHost(browser);
  const guest = await openGuest(browser);
  const teammateContext = await openUser(browser, TEAMMATE);
  await teammateContext.grantPermissions(["camera", "microphone"]);
  await setRtcTestOverrides(teammateContext, { debug: true, forceRelay: false });
  const teammate = await teammateContext.newPage();
  const teammateMeter = new TrafficMeter(teammateContext);
  const guestMeter = new TrafficMeter(guest.context);
  teammateMeter.name(teammate, "teammate");
  guestMeter.name(guest.page, "guest");

  try {
    if (!owner.accessToken) throw new Error("Owner login did not return a token.");
    await workerControls(owner.page);
    await workerControls(teammate);
    await workerControls(guest.page);

    const room = await createAdHocRoom(owner.page, owner.accessToken);
    await joinMeetRoom(owner.page, room);
    await waitForInCall(owner.page);

    // The teammate joins and the owner admits them.
    const teammateMarks = markSetup(teammate, room, () => teammateMeter.start());
    await teammate.goto(`/meet/meetings/${room}`);
    await expect(meetLobby(owner.page)).toBeVisible();
    teammateMarks.admitted = Date.now();
    await admitFirstKnocker(owner.page);
    await waitForInCall(teammate);
    const teammateFrame = await firstRemoteFrame(teammate);

    // The teammate's minute runs alone, before the guest joins.
    await owner.page.waitForTimeout(Math.max(0, 62_000 - (Date.now() - teammateMarks.join)));
    const teammateReport = teammateMeter.report("meet-call-setup-teammate");

    // A guest knocks without signing in and is admitted.
    const guestMarks = markSetup(guest.page, room, () => guestMeter.start());
    await knockAsGuest(guest.page, room, "Ada");
    await expect(meetLobby(owner.page)).toBeVisible();
    guestMarks.admitted = Date.now();
    await admitFirstKnocker(owner.page);
    await waitForInCall(guest.page);
    const guestFrame = await firstRemoteFrame(guest.page);

    const timings = {
      teammate: {
        joinToSignalMs: (teammateMarks.signal ?? Infinity) - teammateMarks.admitted,
        joinToFrameMs: teammateFrame - teammateMarks.admitted,
      },
      guest: {
        joinToSignalMs: (guestMarks.signal ?? Infinity) - guestMarks.admitted,
        joinToFrameMs: guestFrame - guestMarks.admitted,
      },
    };
    writeReport("meet-call-setup-timings", timings);
    for (const who of [timings.teammate, timings.guest]) {
      expect(who.joinToSignalMs).toBeLessThanOrEqual(OFFER_MS);
      expect(who.joinToFrameMs).toBeLessThanOrEqual(FRAME_MS);
    }

    await owner.page.waitForTimeout(Math.max(0, 62_000 - (Date.now() - guestMarks.join)));
    const guestReport = guestMeter.report("meet-call-setup-guest");
    const within = (report: { timeline: unknown[] }, from: number) =>
      (report.timeline as [number, string, string][]).filter(([at]) => at < from).length;
    // The count must include the governed polls, or it passes empty.
    for (const report of [teammateReport, guestReport]) {
      const polls = (report.timeline as [number, string, string][]).filter(
        ([, tab, group]) => tab === "sw" && /^GET \/rooms\/\{id\}\/events/.test(group),
      );
      expect(polls.length).toBeGreaterThan(0);
    }
    expect(within(teammateReport, 60)).toBeLessThan(PER_MINUTE);
    expect(within(guestReport, 60)).toBeLessThan(PER_MINUTE);
  } finally {
    await owner.context.close();
    await guest.context.close();
    await teammateContext.close();
  }
});
