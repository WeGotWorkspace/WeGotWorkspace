import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** Shared setup for the upload queue tests. */
export const UPLOAD_TEST_USER = "ada";

export function uploadTestDb() {
  return offlineDbForAccount(offlineAccountKeyFromUsername(UPLOAD_TEST_USER));
}

export async function clearUploadTestDb(): Promise<void> {
  const db = uploadTestDb();
  await Promise.all([
    driveEntriesTable(db).clear(),
    driveUploadBatchesTable(db).clear(),
    driveUploadItemsTable(db).clear(),
    driveUploadBlobsTable(db).clear(),
    db.table("drive_content_blobs").clear(),
    db.table("drive_availability").clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ]);
}

export function testFile(name: string, contents = "hello", type = "text/plain"): File {
  return new File([contents], name, { type, lastModified: 1 });
}

/** Replace `navigator.storage` for one test; `undefined` removes it. */
export function stubNavigatorStorage(storage: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: storage,
  });
  return () => {
    if (original) Object.defineProperty(globalThis.navigator, "storage", original);
    else Reflect.deleteProperty(globalThis.navigator, "storage");
  };
}
