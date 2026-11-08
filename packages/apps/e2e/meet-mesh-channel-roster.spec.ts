import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, passwordFor, TEAMMATE } from "./helpers/live-matrix";

/**
 * Chat previews on the presence mesh go to the channel's readers only.
 *
 * The owner and the teammate share a Team channel. A third coworker shares a
 * different Team with both, so all three are in one presence room (presence has
 * one room per Team, #1921), but the coworker is not in the channel's Team. When
 * the owner posts, the
 * teammate's data channel carries the message (so the mesh is up and the
 * preview path ran) and the outsider's data channels carry no trace of it,
 * not even the content-free check-now that follows the post.
 */

const OUTSIDER = "e2e-outsider";

type Frame = { text: string };

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a Team channel message reaches the Team on the mesh and no coworker outside it", async ({
  browser,
}) => {
  const run = Date.now().toString(36);
  const group = `e2e-roster-${run}`;
  const channelId = await setUp(group);
  const contexts: BrowserContext[] = [];

  try {
    const owner = await openTapped(browser, OWNER, `/meet/channels/${channelId}`, contexts);
    const teammate = await openTapped(browser, TEAMMATE, `/meet/channels/${channelId}`, contexts);
    const outsider = await openTapped(browser, OUTSIDER, "/meet", contexts);

    // Each browser has a data channel to both others before anyone posts.
    for (const tab of [owner, teammate, outsider]) {
      await expect.poll(() => openChannels(tab), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    }

    const body = `roster-${run} quarterly numbers`;
    const teammateBefore = await frameCount(teammate);
    const outsiderBefore = await frameCount(outsider);
    const composer = owner.getByRole("textbox").last();
    await composer.fill(body);
    await composer.press("Enter");

    await expect
      .poll(async () => (await framesWith(teammate, body)).length, {
        message: "the teammate's data channel carries the preview",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await expect(teammate.getByText(body).first()).toBeVisible();

    // Give a stray send to the outsider the same time to arrive.
    await owner.waitForTimeout(3_000);
    expect(await framesWith(outsider, body), "frames on the outsider's data channels").toEqual([]);
    // The content-free check-now after the post follows the same roster.
    expect(
      await checkNowsSince(teammate, teammateBefore),
      "check-now to the teammate",
    ).toBeGreaterThan(0);
    expect(await checkNowsSince(outsider, outsiderBefore), "check-now to the outsider").toBe(0);
    await expect(outsider.getByText(body)).toHaveCount(0);
    const read = await api(
      OUTSIDER,
      "GET",
      `/chat/channels/${encodeURIComponent(channelId)}/messages`,
    );
    expect(read.status, "the outsider cannot read the channel over REST either").not.toBe(200);
  } finally {
    for (const context of contexts) await context.close();
  }
});

/**
 * The outsider account, a fresh Team of owner + teammate with a channel in it, and a
 * second fresh Team of all three, so they meet in that Team's presence room.
 */
async function setUp(group: string): Promise<string> {
  await ensureCreated(
    await api(OWNER, "POST", "/admin/users", {
      username: OUTSIDER,
      password: passwordFor(OUTSIDER),
      displayName: "E2E Outsider",
      email: `${OUTSIDER}@example.test`,
    }),
  );
  await ensureCreated(
    await api(OWNER, "POST", "/admin/groups", { slug: group, displayName: group }),
  );
  for (const member of [OWNER, TEAMMATE]) {
    await ensureCreated(await api(OWNER, "PUT", `/admin/groups/${group}/members/${member}`));
  }
  const shared = `${group}-room`;
  await ensureCreated(
    await api(OWNER, "POST", "/admin/groups", { slug: shared, displayName: shared }),
  );
  for (const member of [OWNER, TEAMMATE, OUTSIDER]) {
    await ensureCreated(await api(OWNER, "PUT", `/admin/groups/${shared}/members/${member}`));
  }
  const created = await api(OWNER, "POST", "/chat/channels", {
    name: group,
    kind: "channel",
    groupSlug: group,
  });
  if (created.status !== 201) {
    throw new Error(`Create channel ${created.status}: ${JSON.stringify(created.json)}`);
  }
  return (created.json as { id: string }).id;
}

/** 200/201, or 400 "already …" for an account a previous run created. */
async function ensureCreated(res: { status: number; json: unknown }): Promise<void> {
  if (res.status === 200 || res.status === 201) return;
  const error = (res.json as { error?: string } | null)?.error ?? "";
  if (res.status === 400 && /already/i.test(error)) return;
  throw new Error(`Setup ${res.status}: ${JSON.stringify(res.json)}`);
}

/** A signed-in tab whose WebRTC data channels record every inbound frame. */
async function openTapped(
  browser: Parameters<typeof openUser>[0],
  user: string,
  path: string,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await openUser(browser, user);
  contexts.push(context);
  await context.addInitScript(tapDataChannels);
  const tab = await context.newPage();
  await tab.goto(path);
  return tab;
}

function tapDataChannels(): void {
  const state = { frames: [] as { text: string }[], open: new Set<RTCDataChannel>() };
  (window as unknown as { __meshTap: typeof state }).__meshTap = state;
  const decoder = new TextDecoder();
  const wire = (channel: RTCDataChannel) => {
    const markOpen = () => state.open.add(channel);
    if (channel.readyState === "open") markOpen();
    channel.addEventListener("open", markOpen);
    channel.addEventListener("close", () => state.open.delete(channel));
    channel.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as unknown;
      const text =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
            ? decoder.decode(data as ArrayBuffer)
            : "";
      state.frames.push({ text });
    });
  };
  const Native = window.RTCPeerConnection;
  const createDataChannel = Native.prototype.createDataChannel;
  Native.prototype.createDataChannel = function (...args) {
    const channel = createDataChannel.apply(this, args);
    wire(channel);
    return channel;
  };
  const Tapped = function (this: unknown, ...args: ConstructorParameters<typeof Native>) {
    const connection = new Native(...args);
    connection.addEventListener("datachannel", (event) => wire(event.channel));
    return connection;
  } as unknown as typeof RTCPeerConnection;
  Tapped.prototype = Native.prototype;
  Object.setPrototypeOf(Tapped, Native);
  window.RTCPeerConnection = Tapped;
}

async function openChannels(tab: Page): Promise<number> {
  return tab.evaluate(
    () => (window as unknown as { __meshTap?: { open: Set<unknown> } }).__meshTap?.open.size ?? 0,
  );
}

async function frameCount(tab: Page): Promise<number> {
  return tab.evaluate(
    () => (window as unknown as { __meshTap?: { frames: Frame[] } }).__meshTap?.frames.length ?? 0,
  );
}

async function checkNowsSince(tab: Page, from: number): Promise<number> {
  return tab.evaluate(
    (start) =>
      ((window as unknown as { __meshTap?: { frames: Frame[] } }).__meshTap?.frames ?? [])
        .slice(start)
        .filter((frame) => frame.text.includes('"kind":"check-now"')).length,
    from,
  );
}

async function framesWith(tab: Page, needle: string): Promise<Frame[]> {
  return tab.evaluate(
    (text) =>
      ((window as unknown as { __meshTap?: { frames: Frame[] } }).__meshTap?.frames ?? []).filter(
        (frame) => frame.text.includes(text),
      ),
    needle,
  );
}
