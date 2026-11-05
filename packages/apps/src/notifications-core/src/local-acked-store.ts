import {
  browserStorage,
  createIdListStore,
  type IdListStore,
  type IdStorage,
} from "@/notifications-core/src/id-list-store";

/**
 * Inbox rows this browser has already local-acked, kept across reloads so a
 * page load does not ack the whole unread list again (#1826). Every tab of the
 * browser reads the same list.
 *
 * Notification ids are server ULIDs that belong to one user, so one list
 * serves every account on the device. The `wgw.offline.` prefix puts it in the
 * sign-out wipe with the rest of the device's account data.
 */
export const LOCAL_ACKED_STORAGE_KEY = "wgw.offline.notifications.localAcked";

/**
 * The inbox lists at most 100 unread rows; keeping several pages' worth means
 * an old row only comes back for a second ack after hundreds of newer ones.
 */
export const LOCAL_ACKED_MAX_IDS = 500;

export type LocalAckedStore = IdListStore;

export function createLocalAckedStore(
  storage: IdStorage | null,
  maxIds: number = LOCAL_ACKED_MAX_IDS,
): LocalAckedStore {
  return createIdListStore(storage, LOCAL_ACKED_STORAGE_KEY, maxIds);
}

export function browserLocalAckedStore(): LocalAckedStore {
  return createLocalAckedStore(browserStorage());
}
