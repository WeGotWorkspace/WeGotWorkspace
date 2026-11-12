import { USING, jmap1, setOk } from "../../client/jmap.mjs";
import { roomCode } from "../../client/ids.mjs";
import { need } from "../api/collab.mjs";
import { fileBytes } from "../api/files.mjs";

const T = 30000;
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
const online = (page) => page.locator('[data-connectivity="online"]').first().waitFor({ timeout: T }).catch(() => {});

/** Emoji render as images in chat, so match on the text before the first one. */
const plainPrefix = (text) => text.split(/\p{Extended_Pictographic}/u)[0].trim().slice(0, 60);

/** Types at the end of a ProseMirror editor. */
async function typeAtEnd(page, editor, text) {
  await editor.click({ timeout: T });
  // Ctrl/Cmd+End is not "end of document" on every platform: put the caret there directly.
  await editor.evaluate((el) => {
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    sel.collapseToEnd();
  });
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(text);
}

/** The flags the planner set: offline mid-edit, a reload mid-action, a second tab. */
async function withFlags(b, a, during) {
  const { page, context } = b;
  if (a.flags?.offline) {
    await context.setOffline(true);
    try {
      await during();
      await settle(page, 4000);
    } finally {
      await context.setOffline(false);
    }
    await online(page);
    await settle(page, 5000);
    return "edited offline, then back online";
  }
  if (a.flags?.secondTab) {
    const second = await context.newPage();
    await second.goto(page.url());
    await during();
    await settle(second, 3000);
    b.second = second;
    return "second tab open";
  }
  await during();
  if (a.flags?.reload) {
    await page.reload();
    await online(page);
    return "reloaded mid-action";
  }
  return null;
}

async function chatComposer(page) {
  const composer = page.locator(".meet-workspace__chat-composer .ProseMirror").first();
  await composer.waitFor({ timeout: T });
  return composer;
}

/** Each returns `{ ids?, extra?, note? }` like the API executors. */
export const uiActions = {
  async "chat.post"(b, a, ctx) {
    const ch = need(ctx, a.params.channel);
    const { page } = b;
    await b.open(`/meet/channels/${encodeURIComponent(ch.ids.channelId)}`, async () => {
      await online(page);
      await chatComposer(page);
    });
    const note = await withFlags(b, a, async () => {
      const composer = await chatComposer(page);
      await composer.click();
      await page.keyboard.insertText(a.params.text);
      await page.keyboard.press("Enter");
    });
    await b.wait("message shown", () => page.locator(".chat-message__body", { hasText: plainPrefix(a.params.text) }).first().waitFor({ timeout: T }));
    if (b.second) {
      await b.second.locator(".chat-message__body", { hasText: plainPrefix(a.params.text) }).first().waitFor({ timeout: T });
      await b.second.close();
      b.second = null;
    }
    const { list } = await ctx.client(a.persona).get(`/api/v1/chat/channels/${encodeURIComponent(ch.ids.channelId)}/messages?limit=30`);
    const msg = list.find((m) => m.body?.includes(a.params.text) && m.authorId === a.persona);
    if (!msg) throw new Error("message shown in the browser is not on the server");
    return { ids: { channelId: ch.ids.channelId, messageId: msg.id }, extra: { channel: a.params.channel }, note };
  },

  async "note.create"(b, a, ctx) {
    const { page } = b;
    // A note started before the notebooks have loaded lands in a local "Drafts" that never syncs; wait for them.
    await b.open("/notes", () => page.getByRole("region", { name: "My notebooks" }).getByRole("button", { name: "General", exact: true }).waitFor({ timeout: T }));
    ctx.friction?.({ what: "A note started before the notebook list has loaded is never saved", workaround: "wait for the notebook list before clicking New note", source: "actor-workaround" });
    await page.getByRole("button", { name: "New note" }).click({ timeout: T });
    const title = page.getByRole("textbox", { name: "Title" });
    await title.waitFor({ timeout: T });
    const note = await withFlags(b, a, async () => {
      await title.fill(a.params.title);
      await page.getByRole("textbox", { name: "Note" }).click();
      await page.keyboard.insertText(a.params.body.split("\n")[0]);
    });
    await settle(page, 4000);
    const found = await findNote(ctx, a.persona, a.params.title, page.url());
    if (!found) throw new Error(`note "${a.params.title}" typed in the browser is not on the server`);
    return { ids: { noteId: found.id }, extra: { title: a.params.title }, note };
  },

  async "note.edit"(b, a, ctx) {
    const n = need(ctx, a.params.note);
    const { page } = b;
    const editor = page.locator(".ProseMirror").first();
    await b.open(`/notes/all/${encodeURIComponent(n.ids.noteId)}`, () => editor.waitFor({ timeout: T }));
    await online(page);
    const note = await withFlags(b, a, () => typeAtEnd(page, editor, a.params.append));
    await settle(page, 4000);
    const server = await ctx.client(a.persona).get(`/api/v1/notes/items/${encodeURIComponent(n.ids.noteId)}`);
    if (!String(server.body ?? "").includes(a.params.append.slice(2, 20))) throw new Error("note edit typed in the browser is not on the server");
    return { note };
  },

  async "task.create"(b, a, ctx) {
    const list = need(ctx, a.params.list);
    const { page } = b;
    const box = page.getByRole("textbox", { name: "Quick add task" });
    await b.open(`/tasks/lists/${encodeURIComponent(list.ids.listId)}`, () => box.waitFor({ timeout: T }));
    const note = await withFlags(b, a, async () => {
      await box.fill(a.params.title);
      await box.press("Enter");
      await b.wait("task shown", () => page.locator(".tasks-list-row .list-item__title", { hasText: a.params.title }).first().waitFor({ timeout: T }));
    });
    if (a.params.assignee) ctx.friction?.({ what: "The Tasks screen has no way to assign a task to a colleague", workaround: "the task stays unassigned; the persona says it in chat", source: "actor-workaround" });
    await settle(page, 2000);
    const { list: items } = await ctx.client(a.persona).get(`/api/v1/tasks/items?taskListId=${encodeURIComponent(list.ids.listId)}`);
    const task = items.filter((t) => t.title === a.params.title).sort((x, y) => String(y.created ?? "").localeCompare(String(x.created ?? "")))[0];
    if (!task) throw new Error("task added in the browser is not on the server");
    return { ids: { taskId: task.id, listId: list.ids.listId }, extra: { status: "open", title: a.params.title }, note: note ?? "no assignee: the Tasks UI has no assign control" };
  },

  async "doc.edit"(b, a, ctx) {
    const doc = need(ctx, a.params.doc);
    const { page } = b;
    await openDoc(b, doc.ids.path);
    const editor = page.locator(".ProseMirror").first();
    const note = await withFlags(b, a, () => typeAtEnd(page, editor, a.params.append));
    await waitSaved(b, page);
    await expectDocContains(ctx, a.persona, doc.ids.path, a.params.append);
    return { note };
  },

  async "doc.cowrite"(b, a, ctx) {
    const doc = need(ctx, a.params.doc);
    const partner = await ctx.extraBrowser(a.params.partner);
    try {
      await Promise.all([openDoc(b, doc.ids.path), openDoc(partner, doc.ids.path)]);
      // Both join the shared session first: typing in the first seconds after opening can be dropped (a separate scenario).
      await b.wait("wait until the co-writer has joined", () => settle(b.page, 5000));
      ctx.friction?.({ what: "Text typed in the first seconds after opening a shared doc can be lost", workaround: "wait until the co-writer has joined before typing", source: "actor-workaround" });
      const mine = `${ctx.world.persona(a.persona).displayName.split(" ")[0]}: ${a.params.text}`;
      const theirs = `${ctx.world.persona(a.params.partner).displayName.split(" ")[0]}: ${a.params.text.split(" ").reverse().join(" ")}`;
      await Promise.all([
        typeAtEnd(b.page, b.page.locator(".ProseMirror").first(), mine),
        typeAtEnd(partner.page, partner.page.locator(".ProseMirror").first(), theirs),
      ]);
      await Promise.all([waitSaved(b, b.page), waitSaved(partner, partner.page)]);
      await settle(b.page, 3000);
      for (const p of [b.page, partner.page]) {
        const text = await p.locator(".ProseMirror").first().innerText();
        if (!text.includes(mine.slice(0, 25)) || !text.includes(theirs.slice(0, 25))) throw new Error("co-writers do not see each other's text in the editor");
      }
      await expectDocContains(ctx, a.persona, doc.ids.path, mine);
      await expectDocContains(ctx, a.persona, doc.ids.path, theirs);
      return { note: `co-wrote with ${a.params.partner}` };
    } finally {
      await partner.close();
    }
  },

  async "cal.event"(b, a, ctx) {
    const { page } = b;
    const c = ctx.client(a.persona);
    const before = new Set((await jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: a.persona })).ids ?? []);
    const day = a.params.start.slice(0, 10);
    await b.open(`/calendar/week/${day}`, () => page.locator(".calendar-workspace").waitFor({ timeout: T }));
    await page.getByRole("button", { name: "New event" }).click({ timeout: T });
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.waitFor({ timeout: T });
    await dialog.getByLabel("Title").fill(a.params.title);
    await dialog.getByRole("button", { name: "Save" }).click();
    await b.wait("event saved", () => dialog.waitFor({ state: "hidden", timeout: T }));
    await settle(page, 2000);
    // The new event is the one that was not there before: an invite with the same title may already be in this calendar.
    const q = await jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: a.persona });
    const fresh = (q.ids ?? []).filter((x) => !before.has(x));
    if (fresh.length !== 1) throw new Error(`expected one new event after saving in the browser, found ${fresh.length}`);
    const [id] = fresh;
    // Guests are added from the event's attendee field in real use; the harness adds them over JMAP.
    const participants = { org: { "@type": "Participant", email: ctx.world.email(a.persona), name: ctx.world.persona(a.persona).displayName, roles: { owner: true, attendee: true }, participationStatus: "accepted" } };
    for (const p of a.params.attendees) participants[`a-${p}`] = { "@type": "Participant", email: ctx.world.email(p), name: ctx.world.persona(p).displayName, roles: { attendee: true }, expectReply: true, participationStatus: "needs-action" };
    for (const [i, email] of (a.params.external ?? []).entries()) participants[`x${i}`] = { "@type": "Participant", email, name: email.split("@")[0], roles: { attendee: true }, expectReply: true, participationStatus: "needs-action" };
    setOk(await jmap1(c, USING.calendars, "CalendarEvent/set", { accountId: a.persona, update: { [id]: { participants } } }), "add attendees");
    const got = await jmap1(c, USING.calendars, "CalendarEvent/get", { accountId: a.persona, ids: [id], properties: ["uid", "start"] });
    for (const to of a.params.attendees) ctx.expectNotify({ to, domain: "calendar", action: "invite", from: a.persona, n: a.n, title: a.params.title });
    for (const to of a.params.external ?? []) ctx.expectMail({ to, n: a.n, title: a.params.title });
    return { ids: { eventId: id, uid: got.list?.[0]?.uid, calendarId: "default" }, extra: { attendees: a.params.attendees, external: a.params.external, title: a.params.title, start: `${got.list?.[0]?.start ?? a.params.start.slice(0, 19)}Z`.replace("ZZ", "Z") }, note: "time from the default slot; attendees added over JMAP" };
  },

  async "contact.create"(b, a, ctx) {
    const { page } = b;
    const add = page.getByRole("button", { name: "New contact", exact: true });
    await b.open("/contacts/all", () => add.waitFor({ timeout: T }));
    await add.click({ timeout: T });
    const [first, ...rest] = a.params.name.split(" ");
    await page.getByLabel("First name").fill(first);
    await page.getByLabel("Last name").fill(rest.join(" "));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await settle(page, 3000);
    const c = ctx.client(a.persona);
    const q = await jmap1(c, USING.contacts, "ContactCard/query", { accountId: a.persona });
    const got = await jmap1(c, USING.contacts, "ContactCard/get", { accountId: a.persona, ids: q.ids ?? [], properties: ["id", "name"] });
    const card = (got.list ?? []).filter((x) => (x.name?.full ?? "").includes(rest.join(" ") || first)).pop();
    if (!card) throw new Error("contact saved in the browser is not on the server");
    return { ids: { cardId: card.id }, extra: { name: a.params.name }, note: "name only; email and phone are not typed in the browser" };
  },

  async "drive.upload"(b, a, ctx) {
    const folder = need(ctx, a.params.folder).ids.path;
    const { page } = b;
    const segments = folder.split("/").filter(Boolean).slice(1);
    await b.open("/drive", () => online(page));
    for (const name of segments) {
      const team = ctx.world.teams.find((t) => t.id === name);
      const row = page.getByRole("button", { name: team?.name ?? name, exact: true }).or(page.getByRole("button", { name, exact: true }));
      await row.first().dblclick({ timeout: T });
      await settle(page, 1200);
    }
    const bytes = Math.min(a.params.bytes, 20 * 1024 * 1024);
    await page.locator('input[type="file"][aria-label="Upload files"]').setInputFiles({ name: a.params.name, mimeType: "application/octet-stream", buffer: fileBytes(a.params.name, bytes) });
    // Files over the offline limit ask whether to keep a copy on this device first.
    const keep = page.getByRole("dialog", { name: "Keep this file on this device?" });
    if (await keep.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      ctx.friction?.({ what: "Every upload over 8 MB first asks whether to keep the file on this device", workaround: "answer the dialog before the upload starts", source: "detected" });
      await keep.getByRole("button", { name: "Upload", exact: true }).click();
    }
    await b.wait("upload finished", () => waitForServerFile(ctx, a.persona, `${folder}/${a.params.name}`, bytes));
    return { ids: { path: `${folder}/${a.params.name}` }, extra: { bytes, size: a.params.size }, note: bytes < a.params.bytes ? `browser upload capped at ${bytes} bytes` : null };
  },

  async "meet.call"(b, a, ctx) {
    const { page } = b;
    const room = roomCode();
    await ctx.client(a.persona).post("/api/v1/meetings/rooms", { room, ownerPrincipal: `u:${a.persona}` });
    await page.goto(`/meet/meetings/${room}`);
    const exit = (p) => p.getByRole("button", { name: /^(Leave|End)( call)?$/ }).first();
    // The room's owner may be joined straight away; otherwise start the call from the header.
    if (!(await exit(page).waitFor({ timeout: 8000 }).then(() => true, () => false))) {
      await page.locator(".meet-workspace__header-actions").getByRole("button", { name: "Meet", exact: true }).click({ timeout: T });
      await exit(page).waitFor({ timeout: T });
    }
    const guest = await ctx.guestBrowser();
    try {
      await guest.page.goto(`/meet/meetings/${room}`);
      await guest.page.getByLabel("Your name").fill(a.params.guest);
      await guest.page.getByRole("button", { name: "Knock to join" }).click({ timeout: T });
      await b.wait("guest admitted", async () => {
        await page.getByRole("region", { name: /waiting in the lobby/ }).getByRole("button", { name: /^Admit / }).first().click({ timeout: T });
        await exit(guest.page).waitFor({ timeout: T });
      });
      await settle(page, 15000);
      await exit(guest.page).click();
    } finally {
      await guest.close();
    }
    await exit(page).click().catch(() => {});
    return { note: `call with guest ${a.params.guest}` };
  },
};

async function openDoc(b, path) {
  await b.open(`/docs?file=${encodeURIComponent(path.replace(/^\//, ""))}`, async () => {
    await b.page.locator(".ProseMirror").first().waitFor({ timeout: T });
    await online(b.page);
  });
}

async function waitSaved(b, page) {
  await settle(page, 1500);
  await b.wait("doc saved", () =>
    page.getByRole("status", { name: "Unsaved changes" }).waitFor({ state: "hidden", timeout: 45000 }).catch(() => {
      throw new Error("Docs still shows 'Unsaved changes' after 45 s");
    }),
  );
}

async function expectDocContains(ctx, persona, path, text) {
  for (let i = 0; i < 10; i += 1) {
    const res = await ctx.client(persona).request("GET", `/api/v1/files/content?path=${encodeURIComponent(path)}`, { headers: { accept: "*/*" } });
    if (res.ok && res.text.includes(text.slice(0, 30))) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`text typed in Docs is not in the saved file after 30 s: "${text.slice(0, 40)}"`);
}

/** Upload finished: the file is listed on the server with the full size. */
async function waitForServerFile(ctx, persona, path, bytes, timeoutMs = 180000) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const until = Date.now() + timeoutMs;
  let last = "not listed";
  while (Date.now() < until) {
    const res = await ctx.client(persona).request("GET", `/api/v1/files/children?path=${encodeURIComponent(dir)}`);
    const f = res.ok ? (res.json?.data?.files ?? []).find((x) => x.name === name) : null;
    if (f && f.size === bytes) return;
    last = f ? `listed with ${f.size} of ${bytes} bytes` : res.ok ? "not listed" : `HTTP ${res.status}`;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`uploaded in the browser, but after ${timeoutMs / 1000} s the server has it ${last}`);
}

/** The open note's id is the last segment of the Notes route; poll until the server has the title. */
async function findNote(ctx, persona, title, url) {
  const id = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  if (!id || id === "notes" || id === "all") return null;
  for (let i = 0; i < 8; i += 1) {
    const res = await ctx.client(persona).request("GET", `/api/v1/notes/items/${encodeURIComponent(id)}`);
    if (res.ok && (res.json.title ?? "") === title) return res.json;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}
