// Notes created and deleted over REST, next to a live page, for specs that need
// many notes (#1792 re-list, #1641 windowed list).
import type { Page } from "@playwright/test";
import { E2E_NOTEBOOK_ID } from "./notes-live";

/**
 * The signed-in tab's access token, for REST calls made next to the page. Read
 * from the context's storage, so an in-app navigation cannot interrupt it.
 */
async function accessToken(page: Page): Promise<string> {
  const { origins } = await page.context().storageState();
  const origin = new URL(page.url()).origin;
  const token = origins
    .find((entry) => entry.origin === origin)
    ?.localStorage.find((item) => item.name === "wgw.api.access_token")?.value;
  if (!token) throw new Error("No access token in the signed-in tab");
  return token;
}

/** Send one REST request, retrying a 429 so seeding never flakes on the budget. */
async function send(
  page: Page,
  token: string,
  method: "POST" | "DELETE",
  path: string,
  data?: unknown,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await page.request.fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      data,
    });
    if (response.status() !== 429) return response;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

/**
 * Create notes through REST, next to the page (a navigation cannot cut it off).
 * Each id goes into `created` as soon as it exists, so the cleanup also removes
 * the notes of a seed that failed part-way.
 */
export async function createNotes(page: Page, titles: string[], created: string[]): Promise<void> {
  const token = await accessToken(page);
  const create = async (title: string): Promise<void> => {
    const response = await send(page, token, "POST", "/api/v1/notes/items", {
      uid: crypto.randomUUID(),
      notebookId: E2E_NOTEBOOK_ID,
      title,
      body: title,
      categories: [],
    });
    if (!response.ok()) {
      throw new Error(`Seed note failed (${response.status()}): ${await response.text()}`);
    }
    created.push(((await response.json()) as { id: string }).id);
  };
  for (let at = 0; at < titles.length; at += 8) {
    await Promise.all(titles.slice(at, at + 8).map(create));
  }
}

/** Delete notes through REST, so later live specs meet the account as it was. */
export async function deleteNotes(page: Page, ids: string[]): Promise<void> {
  const token = await accessToken(page);
  for (let at = 0; at < ids.length; at += 8) {
    await Promise.all(
      ids
        .slice(at, at + 8)
        .map((id) => send(page, token, "DELETE", `/api/v1/notes/items/${encodeURIComponent(id)}`)),
    );
  }
}
