/**
 * On-device ring buffer of recent unexpected errors (#2204). Settings → Diagnostics
 * copies it into a bug report. Nothing here sends anything: the rows stay in this
 * browser until the person copies them, and logout deletes the database.
 */

export const ERROR_DIAGNOSTICS_DB_NAME = "wgw-error-diagnostics";
/** How many errors the device keeps. The oldest is dropped first. */
export const ERROR_DIAGNOSTICS_LIMIT = 50;

const STORE = "errors";

export type ErrorDiagnosticSource = "error" | "unhandledrejection" | "render" | "route";

export type ErrorDiagnosticEntry = {
  id: number;
  /** ISO time of the latest occurrence. */
  time: string;
  source: ErrorDiagnosticSource;
  name: string;
  message: string;
  stack: string;
  /** First path segment, `home` for `/`. */
  app: string;
  /** Path only: no query string, no fragment. */
  route: string;
  build: string;
  userAgent: string;
  /** Occurrences in a row of the same error, so a loop does not push out the cause. */
  count: number;
};

export type NewErrorDiagnostic = Omit<ErrorDiagnosticEntry, "id" | "count">;

function openDiagnosticsDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(ERROR_DIAGNOSTICS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Logout deletes this database; never hold it open against that.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function sameError(a: ErrorDiagnosticEntry, b: NewErrorDiagnostic): boolean {
  return (
    a.source === b.source &&
    a.name === b.name &&
    a.message === b.message &&
    a.stack === b.stack &&
    a.route === b.route
  );
}

async function inTransaction<T>(
  idb: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, settle: (value: T) => void) => void,
): Promise<T> {
  const db = await openDiagnosticsDb(idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      let result: T;
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      run(tx.objectStore(STORE), (value) => {
        result = value;
      });
    });
  } finally {
    db.close();
  }
}

function dropOldest(store: IDBObjectStore): void {
  const counted = store.count();
  counted.onsuccess = () => {
    let excess = counted.result - ERROR_DIAGNOSTICS_LIMIT;
    if (excess <= 0) return;
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
  };
}

/** Add one error, or count it again when it repeats the newest one. */
export function appendErrorDiagnostic(
  entry: NewErrorDiagnostic,
  idb: IDBFactory = indexedDB,
): Promise<void> {
  return inTransaction<void>(idb, "readwrite", (store) => {
    const newest = store.openCursor(null, "prev");
    newest.onsuccess = () => {
      const cursor = newest.result;
      const last = cursor?.value as ErrorDiagnosticEntry | undefined;
      if (cursor && last && sameError(last, entry)) {
        cursor.update({ ...last, time: entry.time, count: last.count + 1 });
        return;
      }
      store.add({ ...entry, count: 1 });
      dropOldest(store);
    };
  });
}

/** Newest first. */
export function readErrorDiagnostics(idb: IDBFactory = indexedDB): Promise<ErrorDiagnosticEntry[]> {
  return inTransaction<ErrorDiagnosticEntry[]>(idb, "readonly", (store, settle) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? (request.result as ErrorDiagnosticEntry[]) : [];
      settle(rows.reverse());
    };
  });
}
