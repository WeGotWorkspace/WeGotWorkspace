import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * Only your own camera self-view is mirrored (#2133, #1216). Remote cameras and
 * every screen share are drawn the right way round, and others always see you
 * unmirrored. The owner's camera is named like Apple's Studio Display camera,
 * whose "Display" once made Meet treat it as a screen share.
 */

const STUDIO_DISPLAY = "Studio Display Camera";

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("only your own camera is mirrored, before, during and after a screen share", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const channelId = await setUp(`e2e-mirror-${Date.now().toString(36)}`);
  const contexts: BrowserContext[] = [];

  try {
    const owner = await openMember(browser, OWNER, channelId, contexts, STUDIO_DISPLAY);
    const teammate = await openMember(browser, TEAMMATE, channelId, contexts);

    await owner.getByRole("button", { name: "Meet", exact: true }).first().click();
    await expect(owner.getByRole("button", { name: "Leave" })).toBeVisible();
    await teammate.getByRole("button", { name: "Join", exact: true }).click();
    await expect(teammate.getByRole("button", { name: "Leave" })).toBeVisible();

    // Cameras: each side sees itself mirrored and the other the right way round.
    for (const page of [owner, teammate]) {
      await expect
        .poll(() => tiles(page), { timeout: 45_000 })
        .toEqual([
          { self: true, mirrored: true },
          { self: false, mirrored: false },
        ]);
    }

    // The owner shares a screen with the camera still on.
    await owner.getByRole("button", { name: "Share screen" }).click();
    await owner.getByRole("menuitem", { name: "Optimize for text" }).click();
    await expect(owner.getByRole("button", { name: "Stop sharing" })).toBeVisible();
    await expect.poll(() => shareMirrored(owner)).toBe(false);
    await expect
      .poll(() => tiles(owner))
      .toEqual([
        { self: true, mirrored: true },
        { self: false, mirrored: false },
      ]);
    // The teammate receives the share in the owner's tile, unmirrored.
    await expect
      .poll(() => tiles(teammate))
      .toEqual([
        { self: true, mirrored: true },
        { self: false, mirrored: false },
      ]);

    // Back to the camera: nothing sticks from the share.
    await owner.getByRole("button", { name: "Stop sharing" }).click();
    await owner.getByRole("menuitem", { name: "Stop sharing" }).click();
    await expect(owner.getByRole("button", { name: "Share screen" })).toBeVisible();
    for (const page of [owner, teammate]) {
      await expect
        .poll(() => tiles(page))
        .toEqual([
          { self: true, mirrored: true },
          { self: false, mirrored: false },
        ]);
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

async function openMember(
  browser: Parameters<typeof openUser>[0],
  user: string,
  channelId: string,
  contexts: BrowserContext[],
  cameraLabel?: string,
): Promise<Page> {
  const context = await openUser(browser, user);
  contexts.push(context);
  await context.grantPermissions(["camera", "microphone"]);
  if (cameraLabel) await context.addInitScript(renameCamera, cameraLabel);
  const tab = await context.newPage();
  await tab.goto(`/meet/channels/${channelId}`);
  return tab;
}

/** Give every camera track this page opens the label `label`. */
function renameCamera(label: string): void {
  const media = navigator.mediaDevices;
  const getUserMedia = media.getUserMedia.bind(media);
  media.getUserMedia = async (constraints) => {
    const stream = await getUserMedia(constraints);
    for (const track of stream.getVideoTracks()) {
      Object.defineProperty(track, "label", { value: label });
    }
    return stream;
  };
}

/**
 * Each tile's playing video, self first. In a grid without pins only the self
 * tile is muted (its capture must never reach the speakers).
 */
async function tiles(page: Page): Promise<{ self: boolean; mirrored: boolean }[]> {
  return page.locator(".meet-peer-tile video.meet-stream-video").evaluateAll((videos) =>
    (videos as HTMLVideoElement[])
      .filter((video) => video.videoWidth > 0)
      .map((video) => ({
        self: video.muted,
        mirrored: getComputedStyle(video).transform.startsWith("matrix(-1"),
      }))
      .sort((a, b) => Number(b.self) - Number(a.self)),
  );
}

async function shareMirrored(page: Page): Promise<boolean | null> {
  const video = page.locator("video.meet-call-stage__screen");
  if ((await video.count()) === 0) return null;
  return video.evaluate((node) => getComputedStyle(node).transform.startsWith("matrix(-1"));
}
