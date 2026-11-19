// A stored state that does not hold the note's text is never shown (live app and API, #2208).
//
// The server stores the Yjs state a writer sends without reading it. A writer
// can therefore store a state whose text ("Planted" / "Other") is not the
// title and body everyone else reads ("Real" / "Plan"). Both tabs must open
// the served text, with no outside-write question, and the next save must
// store what was typed on top of it.
import * as Y from "yjs";
import { encodeFramedPayload } from "../src/lib/wire/framed-payload";
import { expect, test, type Page } from "./helpers/live-test";
import { apiToken } from "./helpers/live-matrix";
import {
  api,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  serverNote,
  warmUpApp,
} from "./helpers/notes-matrix";

/**
 * The live note body. While the collab session joins, a read-only stand-in shows
 * the served text; only the editable body is the editor a spec may type in or
 * read the collab state from.
 */
const NOTE_EDITOR = '.ProseMirror[contenteditable="true"]';

test.use({ storageState: { cookies: [], origins: [] } });

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

/** The editor's text, without collaboration carets and their name labels. */
function editorText(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    if (!editor) return "";
    const copy = editor.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('[class*="collaboration-carets"], [class*="collaboration-cursor"]')
      .forEach((node) => node.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  }, NOTE_EDITOR);
}

function titleText(page: Page): Promise<string> {
  return page.getByPlaceholder("Title").first().inputValue();
}

/** A state whose body and title are not the text sent beside it. */
function plantedState(): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText("Planted")]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  doc.getText("note-title").insert(0, "Other");
  return Y.encodeStateAsUpdate(doc);
}

async function plantState(uid: string): Promise<void> {
  const markdown = new TextEncoder().encode("Real");
  const yjs = plantedState();
  const body = encodeFramedPayload(
    { documentLen: markdown.byteLength, yjsLen: yjs.byteLength, title: "Plan" },
    [markdown, yjs],
  );
  const res = await fetch(`${API}/api/v1/notes/items/${uid}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await apiToken(OWNER)}`,
      Accept: "application/json",
      "Content-Type": "application/octet-stream",
      "If-None-Match": "*",
    },
    body,
  });
  if (!res.ok) throw new Error(`planting the state: ${res.status} ${await res.text()}`);
}

async function openNote(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator(NOTE_EDITOR).first().waitFor({ timeout: 60_000 });
}

test("a planted state opens as the served text in two tabs and the next save stores the typing", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await warmUpApp(browser);
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const path = `/notes/notebooks/${PRIVATE_NOTEBOOK}/${uid}`;
  const created = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: PRIVATE_NOTEBOOK,
    title: "Plan",
    body: "Real",
  });
  expect(created.status).toBe(201);
  await plantState(uid);

  const context = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await openNote(a, path);
    const b = await openNotesTab(context, OWNER, "B", events);
    await openNote(b, path);

    for (const tab of [a, b]) {
      await expect.poll(() => editorText(tab), { timeout: 30_000 }).toBe("Real");
      await expect.poll(() => titleText(tab), { timeout: 30_000 }).toBe("Plan");
      await expect(tab.getByText("Changed outside the app")).toHaveCount(0);
    }

    const body = a.locator(NOTE_EDITOR).first();
    await body.click();
    await a.keyboard.press("ControlOrMeta+End");
    await body.pressSequentially(" and typed", { delay: 20 });
    await b.reload();
    await b.locator(NOTE_EDITOR).first().waitFor({ timeout: 60_000 });

    for (const tab of [a, b]) {
      await expect.poll(() => editorText(tab), { timeout: 30_000 }).toBe("Real and typed");
      await expect(tab.getByText("Changed outside the app")).toHaveCount(0);
    }
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body, { timeout: 30_000 })
      .toBe("Real and typed");
    expect((await serverNote(OWNER, uid))?.title).toBe("Plan");
    expect(events.filter((event) => /pageerror/i.test(event))).toEqual([]);
  } finally {
    await context.close();
  }
});

type BodyState = { busy: string | null; editable: string | null; text: string };

/**
 * While the collab session joins, the note shows its served text in a read-only
 * stand-in (no empty body). The stand-in is not the editor: it is marked busy and
 * is never editable, and typing starts only once the live body is up.
 */
test("a reloaded note shows its text read-only first, then the live editor takes typing", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await warmUpApp(browser);
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const token = `standin-${uid.slice(0, 8)}`;
  const path = `/notes/notebooks/${PRIVATE_NOTEBOOK}/${uid}`;
  const created = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: PRIVATE_NOTEBOOK,
    title: "Stand-in",
    body: "Served text",
  });
  expect(created.status).toBe(201);

  const context = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await openNote(a, path);
    await expect.poll(() => editorText(a), { timeout: 30_000 }).toBe("Served text");

    // From the first paint after the reload, record every state of the stand-in.
    await a.addInitScript(() => {
      const states: BodyState[] = [];
      (window as unknown as { __noteStandIn: BodyState[] }).__noteStandIn = states;
      new MutationObserver(() => {
        const standIn = document.querySelector("[data-note-body-standin]");
        if (!standIn) return;
        states.push({
          busy: standIn.getAttribute("aria-busy"),
          editable: standIn.querySelector(".ProseMirror")?.getAttribute("contenteditable") ?? null,
          text: (standIn.textContent ?? "").trim(),
        });
      }).observe(document, { childList: true, subtree: true });
    });
    await a.reload();
    await a.locator(NOTE_EDITOR).first().waitFor({ timeout: 60_000 });
    const standIn = await a.evaluate(
      () => (window as unknown as { __noteStandIn: BodyState[] }).__noteStandIn,
    );
    // Whenever the stand-in showed, it was busy and not editable.
    for (const state of standIn) {
      expect(state.busy).toBe("true");
      expect(state.editable).not.toBe("true");
    }
    // The live body replaced it: nothing busy is left in the detail.
    await expect(a.locator("[data-note-body-standin]")).toHaveCount(0);

    const body = a.locator(NOTE_EDITOR).first();
    await expect.poll(() => editorText(a), { timeout: 30_000 }).toBe("Served text");
    await body.click();
    await a.keyboard.press("ControlOrMeta+End");
    await body.pressSequentially(` ${token}`, { delay: 20 });
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body ?? "", { timeout: 30_000 })
      .toMatch(new RegExp(`${token}$`));

    const b = await openNotesTab(context, OWNER, "B", events);
    await openNote(b, path);
    await expect.poll(() => editorText(b), { timeout: 30_000 }).toContain(token);
    expect(events.filter((event) => /pageerror/i.test(event))).toEqual([]);
  } finally {
    await context.close();
    await api(OWNER, "DELETE", `/notes/items/${uid}`);
  }
});
