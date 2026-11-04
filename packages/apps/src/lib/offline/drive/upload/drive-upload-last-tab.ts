import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";

type LockQuery = () => Promise<{
  held?: readonly { name?: string }[];
  pending?: readonly { name?: string }[];
}>;

function browserLockQuery(): LockQuery | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: { query?: LockQuery } }).locks;
  return locks?.query ? () => locks.query!() : null;
}

/**
 * Whether no other tab would go on uploading if this one closed (#1522).
 * While files wait, every open tab with an uploader holds or waits for the
 * account's uploader lock, so one holder or waiter at most means this tab
 * is the last. Without the Web Locks API every tab counts as the last: a
 * leave warning too many beats uploads that stop without one.
 */
export async function isLastDriveUploaderTab(
  username: string,
  query: LockQuery | null = browserLockQuery(),
): Promise<boolean> {
  if (!query) return true;
  const name = driveUploaderLockName(username);
  const state = await query();
  const holders = [...(state.held ?? []), ...(state.pending ?? [])].filter(
    (lock) => lock.name === name,
  );
  return holders.length <= 1;
}
