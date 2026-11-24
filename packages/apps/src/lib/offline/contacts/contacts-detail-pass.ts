import { fetchContactCardDetails } from "@/lib/api/wgw/contacts-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  readContactsDetailPassRun,
  saveContactsDetailPage,
} from "@/lib/offline/contacts/contacts-offline-store";
import { notifyContactsCacheChanged } from "@/lib/offline/contacts/contacts-cache-changed";
import { runContactsPhotoPass } from "@/lib/offline/contacts/contacts-photo-pass";

const DETAIL_PASS_LOCK = "wgw.contacts.detailPass";
/** Passes in a row before giving up for now (each newer download installs one). */
const MAX_PASSES_PER_RUN = 5;
const running = new Map<string, Promise<void>>();

/**
 * The second pass of a lean first download: fetches the rest of every card
 * still listed as partial (phones, addresses, notes, everything but the
 * photo) as paced bulk background work, and saves it page by page. The
 * photos follow in the photo pass.
 *
 * One tab per browser fetches at a time (a Web Lock); another tab waits and
 * then finds the list empty. A newer download that installs a new pass stops
 * the running one after its current page. Stopped by a reload or a network
 * error, the pass resumes from the stored list on the next start.
 */
export function runContactsDetailPass(username: string): Promise<void> {
  const inFlight = running.get(username);
  if (inFlight) return inFlight;
  const run = oneTabAtATime(`${DETAIL_PASS_LOCK}/${username}`, () => fetchDetails(username))
    .catch((error: unknown) => {
      console.warn("[contacts] detail pass stopped; it resumes on the next start", error);
    })
    .finally(() => running.delete(username));
  running.set(username, run);
  return run;
}

/**
 * Both background passes of a lean download, in order: the details (what a
 * card needs to be edited), then the photos. Either one resumes on its own.
 */
export function runContactsBackgroundPasses(username: string): Promise<void> {
  return runContactsDetailPass(username).then(() => runContactsPhotoPass(username));
}

/** Thrown out of a page callback to stop a pass a newer one replaced. */
class DetailPassSuperseded extends Error {}

async function fetchDetails(username: string): Promise<void> {
  let previous = null as { id: string; count: number } | null;
  for (let passes = 0; passes < MAX_PASSES_PER_RUN; passes += 1) {
    const pass = await readContactsDetailPassRun(username);
    if (!pass || !readBrowserOnline()) return;
    // The same list again after a full run: what is left cannot be saved now.
    if (previous?.id === pass.id && pass.cardIds.length >= previous.count) return;
    previous = { id: pass.id, count: pass.cardIds.length };
    const stop = new AbortController();
    try {
      await fetchContactCardDetails(
        pass.cardIds,
        async ({ cards }) => {
          const saved = await saveContactsDetailPage(username, pass.id, cards);
          if (saved.changed > 0) notifyContactsCacheChanged(username);
          if (saved.superseded) {
            stop.abort();
            throw new DetailPassSuperseded();
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
