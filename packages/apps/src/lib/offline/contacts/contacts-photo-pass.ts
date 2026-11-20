import { fetchContactCardPhotos } from "@/lib/api/wgw/contacts-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import {
  readContactsPhotoPass,
  saveContactsPhotoPage,
} from "@/lib/offline/contacts/contacts-offline-store";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";

const topic = cacheChangedTopic(CONTACTS_DOMAIN);

/**
 * Hear a change to the Contacts cache written outside the view (photos from
 * the photo pass), in this tab or another one of the same offline account.
 */
export const subscribeContactsCacheChanged = topic.subscribe;

const PHOTO_PASS_LOCK = "wgw.contacts.photoPass";
const running = new Map<string, Promise<void>>();

/**
 * The second pass of a photo-less first download: fetches the photos of the
 * cards still listed in the photo-pass marker, as paced bulk background work,
 * and saves them page by page. One tab per browser runs it (a Web Lock; the
 * others skip). Stopped by a reload or a network error, it resumes from the
 * marker on the next start. Cards show initials until their photo arrives.
 */
export function runContactsPhotoPass(username: string): Promise<void> {
  const inFlight = running.get(username);
  if (inFlight) return inFlight;
  const run = inOneTab(`${PHOTO_PASS_LOCK}/${username}`, () => fetchPhotos(username))
    .catch((error: unknown) => {
      console.warn("[contacts] photo pass stopped; it resumes on the next start", error);
    })
    .finally(() => running.delete(username));
  running.set(username, run);
  return run;
}

async function fetchPhotos(username: string): Promise<void> {
  const ids = await readContactsPhotoPass(username);
  if (ids.length === 0 || !readBrowserOnline()) return;
  await fetchContactCardPhotos(ids, async ({ photos, remainingCardIds }) => {
    const changed = await saveContactsPhotoPage(username, photos, remainingCardIds);
    if (changed > 0) topic.notifyAllTabs(username);
  });
}

/** Runs `work` in one tab of this browser; without Web Locks every tab runs it. */
async function inOneTab(name: string, work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return work();
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (lock) await work();
  });
}
