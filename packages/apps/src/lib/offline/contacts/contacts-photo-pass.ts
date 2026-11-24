import { fetchContactCardPhotos } from "@/lib/api/wgw/contacts-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  readContactsPhotoPassRun,
  saveContactsPhotoPage,
} from "@/lib/offline/contacts/contacts-offline-store";
import { notifyContactsCacheChanged } from "@/lib/offline/contacts/contacts-cache-changed";

const PHOTO_PASS_LOCK = "wgw.contacts.photoPass";
/** Passes in a row before giving up for now (each newer download installs one). */
const MAX_PASSES_PER_RUN = 5;
const running = new Map<string, Promise<void>>();

/**
 * The second pass of a photo-less first download: fetches the photos of the
 * cards still listed in the photo-pass marker, as paced bulk background work,
 * and saves them page by page. Cards show initials until their photo arrives.
 *
 * One tab per browser fetches at a time (a Web Lock); another tab waits and
 * then finds the marker gone, or runs a pass installed meanwhile. A newer
 * download that installs a new pass stops the running one after its current
 * page, and the run goes on with the new list. Stopped by a reload or a
 * network error, the pass resumes from the marker on the next start.
 */
export function runContactsPhotoPass(username: string): Promise<void> {
  const inFlight = running.get(username);
  if (inFlight) return inFlight;
  const run = oneTabAtATime(`${PHOTO_PASS_LOCK}/${username}`, () => fetchPhotos(username))
    .catch((error: unknown) => {
      console.warn("[contacts] photo pass stopped; it resumes on the next start", error);
    })
    .finally(() => running.delete(username));
  running.set(username, run);
  return run;
}

/** Thrown out of a page callback to stop a pass a newer one replaced. */
class PhotoPassSuperseded extends Error {}

async function fetchPhotos(username: string): Promise<void> {
  for (let passes = 0; passes < MAX_PASSES_PER_RUN; passes += 1) {
    const pass = await readContactsPhotoPassRun(username);
    if (!pass || !readBrowserOnline()) return;
    const stop = new AbortController();
    try {
      await fetchContactCardPhotos(
        pass.cardIds,
        async ({ photos, remainingCardIds }) => {
          const saved = await saveContactsPhotoPage(username, pass.id, photos, remainingCardIds);
          if (saved.changed > 0) notifyContactsCacheChanged(username);
          if (saved.superseded) {
            stop.abort();
            throw new PhotoPassSuperseded();
          }
        },
        stop.signal,
      );
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    }
    // Finished or replaced: run whatever pass is stored now (none when done).
  }
}

/** Runs `work` in one tab of this browser at a time; without Web Locks every tab runs it. */
async function oneTabAtATime(name: string, work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return work();
  await locks.request(name, work);
}
