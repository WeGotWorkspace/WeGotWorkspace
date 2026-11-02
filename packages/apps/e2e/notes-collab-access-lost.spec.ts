// A collaborator removed from the note's group leaves the live session (live app and API, #1760).
//
// Admin and a teammate have the same group note open and see each other in
// "Connected editors". Admin then removes the teammate from the group. The
// teammate's open tab gets a 403 from the signaling poll, shows "Access lost"
// and leaves the mesh; admin's roster drops the teammate without a reload.
import { expect, test } from "./helpers/live-test";
import {
  api,
  ensureTeamNotebook,
  openNotesTab,
  openUser,
  OWNER,
  TEAM_NOTEBOOK,
  TEAM_SLUG,
  TEAMMATE,
  warmUpApp,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

test("a member removed from the group loses the open live note", async ({ browser }) => {
  test.setTimeout(240_000);
  await warmUpApp(browser);
  await ensureTeamNotebook();
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const path = `/notes/notebooks/${TEAM_NOTEBOOK}/${uid}`;
  await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: TEAM_NOTEBOOK,
    title: `Access lost ${uid.slice(0, 8)}`,
    body: `Shared text ${Date.now()}.`,
  });

  const adminContext = await openUser(browser, OWNER);
  const memberContext = await openUser(browser, TEAMMATE);
  try {
    const admin = await openNotesTab(adminContext, OWNER, "admin", events);
    await admin.goto(path);
    await admin.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
    const member = await openNotesTab(memberContext, TEAMMATE, "member", events);
    await member.goto(path);
    await member.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });

    // The session is live: each roster lists the other user.
    const adminRoster = admin.getByLabel("Connected editors");
    const memberRoster = member.getByLabel("Connected editors");
    await expect(adminRoster.locator(".docs-collab-presence__chip")).toHaveCount(2, {
      timeout: 60_000,
    });
    await expect(memberRoster.locator(".docs-collab-presence__chip")).toHaveCount(2, {
      timeout: 60_000,
    });

    const refused = member.waitForResponse(
      (response) =>
        response.status() === 403 &&
        response.url().includes("/api/v1/rooms/") &&
        new URL(response.url()).pathname.endsWith("/events"),
      { timeout: 60_000 },
    );
    const removed = await api(OWNER, "DELETE", `/admin/groups/${TEAM_SLUG}/members/${TEAMMATE}`);
    expect(removed.status).toBeLessThan(300);

    // A linked mesh polls about every 20 seconds.
    await refused;
    await expect(member.getByText("Access lost").first()).toBeVisible({ timeout: 60_000 });
    await expect(
      member
        .getByText("You no longer have access to this note. Unsaved edits were not stored.")
        .first(),
    ).toBeVisible();

    // The teammate is gone from admin's roster, with no reload.
    await expect(adminRoster.locator(".docs-collab-presence__chip")).toHaveCount(1, {
      timeout: 60_000,
    });
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await api(OWNER, "PUT", `/admin/groups/${TEAM_SLUG}/members/${TEAMMATE}`).catch(
      () => undefined,
    );
    await adminContext.close().catch(() => undefined);
    await memberContext.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
