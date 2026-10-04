import { expect, test, type Page } from "@playwright/test";
import {
  docTokenOnServer,
  docsUrlForFile,
  expectOfflineIndicator,
  expectPendingDotVisible,
  expectSyncCompleted,
} from "./helpers/docs-live";
import {
  admitFirstKnocker,
  closeSessions,
  countPcCreated,
  createAdHocRoom,
  editorOccurrenceCount,
  goOffline,
  goOnline,
  installRoomEventsChaos,
  joinMeetRoom,
  openUsers,
  shareWithViewer,
  uploadMarkdown,
  waitForInCall,
  waitForRemoteVideo,
  type ChaosSession,
} from "./helpers/rtc-chaos";

/**
 * Real-time chaos suite (#1091). Scenarios stay `test.fixme` until the issue
 * they cover has landed. Parallel workers live in `playwright.chaos.config.mjs`.
 *
 * Live: concurrent seed and offline merge (#1089), viewer body (#1088),
 * accented path (#1087), document over 200 KB (#1093), Meet video and 3s
 * recovery (#1094), dropped-poll admit (#1086), forced HTTP fallback (#1095).
 *
 * Offline merge, the accented path, and the large document waited on #1127.
 * That fix landed in #1128, so those three scenarios already run.
 */

test.describe.configure({ mode: "parallel" });

async function waitForLiveDoc(page: Page, seed: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(seed);
  await expect(editor).toHaveAttribute("contenteditable", "true");
}

async function typeIntoDoc(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const planted = text.slice(0, 8);
  await expect(async () => {
    const current = await editor.innerText();
    if (!current.includes(text) && !current.includes(planted)) {
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.insertText(text);
    }
    await expect(editor).toContainText(text, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test("concurrent first open of an uploaded markdown file shows the content once", async ({
  browser,
}) => {
  const sentence = `Chaos once ${uniqueId()}`;
  const apiPath = `/users/admin/e2e-chaos-once-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin", "admin"]);
  try {
    await uploadMarkdown(apiPath, `# Notes\n\n${sentence}\n`);
    const url = docsUrlForFile(apiPath);
    await Promise.all(sessions.map((session) => session.page.goto(url)));
    for (const session of sessions) {
      await expect
        .poll(() => editorOccurrenceCount(session.page, sentence), { timeout: 45_000 })
        .toBe(1);
    }
  } finally {
    await closeSessions(...sessions);
  }
});

test("an offline edit and an online edit both survive", async ({ browser }) => {
  const onlineToken = uniqueId("online");
  const offlineToken = uniqueId("offline");
  const apiPath = `/users/admin/e2e-chaos-merge-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [online, offline] = sessions;
  try {
    await uploadMarkdown(apiPath, "# Merge\n");
    await Promise.all([
      online.page.goto(docsUrlForFile(apiPath)),
      offline.page.goto(docsUrlForFile(apiPath)),
    ]);
    await waitForLiveDoc(online.page, "Merge");
    await waitForLiveDoc(offline.page, "Merge");

    await goOffline(offline.context);
    await expectOfflineIndicator(offline.page);
    await typeIntoDoc(online.page, onlineToken);
    await expect
      .poll(() => docTokenOnServer(online.page, apiPath, onlineToken), { timeout: 45_000 })
      .toBe(true);
    await typeIntoDoc(offline.page, offlineToken);
    await expectPendingDotVisible(offline.page);
    await goOnline(offline.context);
    await expectSyncCompleted(offline.page);
    await expect
      .poll(() => docTokenOnServer(online.page, apiPath, offlineToken), { timeout: 45_000 })
      .toBe(true);
    await expect
      .poll(() => docTokenOnServer(online.page, apiPath, onlineToken), { timeout: 45_000 })
      .toBe(true);
  } finally {
    await closeSessions(...sessions);
  }
});

test("a viewer cannot change the body", async ({ browser }) => {
  const seed = `Viewer seed ${uniqueId()}`;
  const viewerToken = uniqueId("viewer");
  const apiPath = `/users/admin/e2e-chaos-view-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "member"]);
  const [owner, viewer] = sessions;
  try {
    await uploadMarkdown(apiPath, `# Shared\n\n${seed}\n`);
    await owner.page.goto("/docs");
    await shareWithViewer(owner.page, apiPath, viewer.username);
    await Promise.all([
      owner.page.goto(docsUrlForFile(apiPath)),
      viewer.page.goto(docsUrlForFile(apiPath)),
    ]);
    const viewerEditor = viewer.page.locator(".ProseMirror");
    await expect(viewerEditor).toBeVisible();
    await expect(viewerEditor).toContainText(seed);
    await expect(viewerEditor).toHaveAttribute("contenteditable", "false");

    await viewerEditor.click({ force: true });
    await viewer.page.keyboard.type(viewerToken);
    await viewer.page.waitForTimeout(2_000);

    await expect(viewerEditor).not.toContainText(viewerToken);
    await expect(owner.page.locator(".ProseMirror")).not.toContainText(viewerToken);
    expect(await docTokenOnServer(owner.page, apiPath, viewerToken)).toBe(false);
    expect(await docTokenOnServer(owner.page, apiPath, seed)).toBe(true);
  } finally {
    await closeSessions(...sessions);
  }
});

test("an accented path opens and saves", async ({ browser }) => {
  const token = uniqueId("accent");
  const apiPath = `/users/admin/café-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "member"]);
  const [editor, peer] = sessions;
  try {
    await uploadMarkdown(apiPath, "# Café\n");
    await editor.page.goto("/docs");
    await shareWithViewer(editor.page, apiPath, peer.username, "edit");
    const url = docsUrlForFile(apiPath);
    await Promise.all([editor.page.goto(url), peer.page.goto(url)]);
    await waitForLiveDoc(editor.page, "Café");
    await waitForLiveDoc(peer.page, "Café");
    await typeIntoDoc(editor.page, token);
    await expect
      .poll(() => docTokenOnServer(editor.page, apiPath, token), { timeout: 45_000 })
      .toBe(true);
  } finally {
    await closeSessions(...sessions);
  }
});

test("a document over 200 KB syncs", async ({ browser }) => {
  const tail = uniqueId("tail");
  const edit = uniqueId("edit");
  const apiPath = `/users/admin/e2e-chaos-large-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "member"]);
  const [left, right] = sessions;
  try {
    await uploadMarkdown(apiPath, largeMarkdown(tail));
    await left.page.goto("/docs");
    await shareWithViewer(left.page, apiPath, right.username, "edit");
    const url = docsUrlForFile(apiPath);
    await Promise.all([left.page.goto(url), right.page.goto(url)]);
    await waitForLiveDoc(left.page, tail);
    await waitForLiveDoc(right.page, tail);
    await typeIntoDoc(left.page, edit);
    await expect
      .poll(() => docTokenOnServer(left.page, apiPath, edit), { timeout: 45_000 })
      .toBe(true);
    await expect(right.page.locator(".ProseMirror")).toContainText(tail);
  } finally {
    await closeSessions(...sessions);
  }
});

test("forced HTTP fallback syncs two editors (#1095)", async ({ browser }) => {
  const token = uniqueId("http");
  const apiPath = `/users/admin/e2e-chaos-http-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  try {
    await uploadMarkdown(apiPath, "# HTTP fallback\n");
    const url = `${docsUrlForFile(apiPath)}&rtcForceRelay=1`;
    await Promise.all([left.page.goto(url), right.page.goto(url)]);
    await expect(left.page.locator(".ProseMirror")).toBeVisible();
    await expect(right.page.locator(".ProseMirror")).toBeVisible();
    await typeIntoDoc(left.page, token);
    await expect(right.page.locator(".ProseMirror")).toContainText(token, { timeout: 2_000 });
  } finally {
    await closeSessions(...sessions);
  }
});

test.describe("meet", () => {
  test.describe.configure({ mode: "serial" });

  test("join shows video for both people", async ({ browser }) => {
    const sessions = await openUsers(browser, ["admin", "member"]);
    const [host, member] = sessions;
    try {
      await startCall(host, member);
      await waitForRemoteVideo(host.page);
      await waitForRemoteVideo(member.page);
    } finally {
      await closeSessions(...sessions);
    }
  });

  test("a dropped poll still delivers admit", async ({ browser }) => {
    const sessions = await openUsers(browser, ["admin", "member"]);
    const [host, member] = sessions;
    const chaos = await installRoomEventsChaos(member.context, { throttleMs: 400 });
    try {
      const room = await createAdHocRoom(host.page, host.accessToken);
      await joinMeetRoom(host.page, room);
      await waitForInCall(host.page);
      await joinMeetRoom(member.page, room);
      await expect(host.page.getByRole("button", { name: /waiting to join/ })).toBeVisible();
      chaos.dropNext(3);
      await admitFirstKnocker(host.page);
      await expect.poll(() => chaos.dropped()).toBe(3);
      await waitForInCall(member.page);
    } finally {
      await chaos.dispose();
      await closeSessions(...sessions);
    }
  });

  test("offline for 3 seconds, video recovers without a new peer connection", async ({
    browser,
  }) => {
    const sessions = await openUsers(browser, ["admin", "member"]);
    const [host, member] = sessions;
    const hostPcs = countPcCreated(host.page);
    const memberPcs = countPcCreated(member.page);
    try {
      await startCall(host, member);
      await waitForRemoteVideo(host.page);
      await waitForRemoteVideo(member.page);
      // Let the mesh finish the first negotiation before the snapshot.
      await host.page.waitForTimeout(1_000);
      const hostBefore = hostPcs();
      const memberBefore = memberPcs();

      await goOffline(member.context);
      await member.page.waitForTimeout(3_000);
      await goOnline(member.context);

      await waitForRemoteVideo(host.page);
      await waitForRemoteVideo(member.page);
      expect(hostPcs()).toBe(hostBefore);
      expect(memberPcs()).toBe(memberBefore);
    } finally {
      await closeSessions(...sessions);
    }
  });
});

async function startCall(host: ChaosSession, member: ChaosSession): Promise<void> {
  const room = await createAdHocRoom(host.page, host.accessToken);
  await joinMeetRoom(host.page, room);
  await waitForInCall(host.page);
  await joinMeetRoom(member.page, room);
  await admitFirstKnocker(host.page);
  await waitForInCall(member.page);
}

function uniqueId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Just over 200 KB, with a unique tail the peer must receive. */
function largeMarkdown(tail: string): string {
  const chunk = "Large collab paragraph. ";
  const target = 200 * 1024 + 1;
  let body = "";
  while (body.length < target) body += chunk;
  return `${body}\n\n${tail}\n`;
}
