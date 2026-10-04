import { expect, test } from "@playwright/test";
import {
  appendToActiveDocBody,
  docTokenOnServer,
  docsUrlForFile,
  expectEditorContains,
  expectOfflineIndicator,
  expectPendingDotVisible,
  expectSyncCompleted,
  loginToDocs,
  seedDocAtPath,
  waitForDocSaved,
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
  waitForInCall,
  waitForRemoteVideo,
  type ChaosSession,
} from "./helpers/rtc-chaos";

/**
 * Real-time chaos suite (#1091). Scenarios stay `test.fixme` until the issue
 * they cover has landed. Parallel workers live in `playwright.chaos.config.mjs`.
 *
 * Live: concurrent seed (#1089), offline merge (#1089), viewer body (#1088),
 * accented path (#1087), large doc (#1093), Meet video and 3s recovery (#1094),
 * dropped-poll admit (#1086).
 * Fixme: forced HTTP fallback (#1095).
 */

test.describe.configure({ mode: "parallel" });

test("concurrent first open of an uploaded markdown file shows the content once", async ({
  browser,
}) => {
  const sentence = `Chaos once ${uniqueId()}`;
  const apiPath = `/users/admin/e2e-chaos-once-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin", "admin"]);
  try {
    await loginToDocs(sessions[0].page);
    await seedDocAtPath(sessions[0].page, apiPath, `# Notes\n\n${sentence}\n`);
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
  const apiPath = `/groups/Engineering/e2e-chaos-merge-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [online, offline] = sessions;
  try {
    await loginToDocs(online.page);
    await Promise.all([
      online.page.goto(docsUrlForFile(apiPath)),
      offline.page.goto(docsUrlForFile(apiPath)),
    ]);
    await expect(online.page.locator(".ProseMirror")).toBeVisible();
    await expect(offline.page.locator(".ProseMirror")).toBeVisible();

    await goOffline(offline.context);
    await expectOfflineIndicator(offline.page);
    await appendToActiveDocBody(online.page, onlineToken);
    await waitForDocSaved(online.page, apiPath, onlineToken);
    await appendToActiveDocBody(offline.page, offlineToken);
    await expectPendingDotVisible(offline.page);

    await goOnline(offline.context);
    await expectSyncCompleted(offline.page);
    await waitForDocSaved(offline.page, apiPath, offlineToken);
    await expectEditorContains(online.page, onlineToken);
    await expectEditorContains(online.page, offlineToken);
    await expectEditorContains(offline.page, onlineToken);
    await expectEditorContains(offline.page, offlineToken);
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
    await loginToDocs(owner.page);
    await seedDocAtPath(owner.page, apiPath, `# Shared\n\n${seed}\n`);
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
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [editor, peer] = sessions;
  try {
    await loginToDocs(editor.page);
    await seedDocAtPath(editor.page, apiPath, "# Café\n");
    const url = docsUrlForFile(apiPath);
    await Promise.all([editor.page.goto(url), peer.page.goto(url)]);
    await expect(editor.page.locator(".ProseMirror")).toContainText("Café");
    await expect(peer.page.locator(".ProseMirror")).toContainText("Café");
    await appendToActiveDocBody(editor.page, token);
    await waitForDocSaved(editor.page, apiPath, token);
    await expectEditorContains(peer.page, token);
  } finally {
    await closeSessions(...sessions);
  }
});

test("a document over 200 KB syncs", async ({ browser }) => {
  const tail = uniqueId("tail");
  const edit = uniqueId("edit");
  const apiPath = `/groups/Engineering/e2e-chaos-large-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  try {
    await loginToDocs(left.page);
    await seedDocAtPath(left.page, apiPath, largeMarkdown(tail));
    const url = docsUrlForFile(apiPath);
    await Promise.all([left.page.goto(url), right.page.goto(url)]);
    await expect(left.page.locator(".ProseMirror")).toContainText(tail);
    await expect(right.page.locator(".ProseMirror")).toContainText(tail);
    await appendToActiveDocBody(left.page, edit);
    await expectEditorContains(right.page, edit);
  } finally {
    await closeSessions(...sessions);
  }
});

test.fixme("forced HTTP fallback syncs two editors (#1095)", async ({ browser }) => {
  const token = uniqueId("http");
  const apiPath = `/groups/Engineering/e2e-chaos-http-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  try {
    await loginToDocs(left.page);
    await seedDocAtPath(left.page, apiPath, "# HTTP fallback\n");
    const url = `${docsUrlForFile(apiPath)}&rtcForceRelay=1`;
    await Promise.all([left.page.goto(url), right.page.goto(url)]);
    await expect(left.page.locator(".ProseMirror")).toBeVisible();
    await expect(right.page.locator(".ProseMirror")).toBeVisible();
    await appendToActiveDocBody(left.page, token);
    await expect(right.page.locator(".ProseMirror")).toContainText(token, { timeout: 2_000 });
  } finally {
    await closeSessions(...sessions);
  }
});

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

test("offline for 3 seconds, video recovers without a new peer connection", async ({ browser }) => {
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
