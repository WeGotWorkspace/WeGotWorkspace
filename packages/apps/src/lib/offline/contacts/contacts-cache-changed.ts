import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";

const topic = cacheChangedTopic(CONTACTS_DOMAIN);

/**
 * Tell every tab, this one included, that the Contacts cache changed outside
 * the view that shows it: a first-download page or photos from the photo pass.
 * Contacts lists and Calendar invitee search re-read the cache then.
 */
export const notifyContactsCacheChanged = topic.notifyAllTabs;

/** Hear a change to the Contacts cache of the same offline account, in any tab. */
export const subscribeContactsCacheChanged = topic.subscribe;
