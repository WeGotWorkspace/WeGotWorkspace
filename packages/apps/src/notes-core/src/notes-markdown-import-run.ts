import type { Note } from "@/lib/models/note";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { toDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";
import type {
  NotesMarkdownImportOperations,
  NotesNotebookCollection,
} from "@/lib/models/notes-types";
import {
  NOTE_BODY_MAX_BYTES,
  finalizeImportedBody,
  importedBodyByteLength,
  markdownImageFile,
  parseMarkdownNote,
  readMarkdownImportText,
  type MarkdownImportSkipReason,
} from "@/notes-core/src/notes-markdown-import";

/**
 * Runs a Markdown import batch (#1623): one file at a time, create the note,
 * upload its images, then write the body once. A failing file never stops
 * the batch, except a lost session.
 */

export type NotesMarkdownImportSkipped = {
  fileName: string;
  reason: MarkdownImportSkipReason;
  /** HTTP status when the server refused the write. */
  status?: number;
};

export type NotesMarkdownImportResult = {
  imported: Note[];
  skipped: NotesMarkdownImportSkipped[];
  droppedTags: string[];
  imagesNotImported: number;
};

export type NotesMarkdownImportProgress = { done: number; total: number };

export type RunNotesMarkdownImportOptions = {
  files: readonly File[];
  notebook: NotesNotebookCollection;
  operations: NotesMarkdownImportOperations;
  /** Same `File` → same note uid, so pressing Import again does not duplicate. */
  uidFor: (file: File) => string;
  /** Called after a half-made note was deleted: the next try needs a fresh uid. */
  releaseUid?: (file: File) => void;
  /** Called for each file that became a note, so a Retry can leave it out. */
  onFileImported?: (file: File, note: Note) => void;
  onProgress?: (progress: NotesMarkdownImportProgress) => void;
  signal?: AbortSignal;
  /** Waits between network retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS_MS = [500, 1500];
const RETRY_STATUSES = new Set([502, 503, 504]);

export function importErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function isRetryable(error: unknown): boolean {
  const status = importErrorStatus(error);
  return isFetchNetworkError(error) || (status !== undefined && RETRY_STATUSES.has(status));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry after a network error with the same arguments (the create uid stays the same). */
async function withRetry<T>(
  run: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (signal?.aborted || attempt >= RETRY_DELAYS_MS.length || !isRetryable(error)) {
        throw error;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

class SessionLostError extends Error {}

function reasonForStatus(status: number | undefined): MarkdownImportSkipReason {
  return status === 413 ? "bodyTooLarge" : "failed";
}

async function uploadImages(
  note: Note,
  parsed: ReturnType<typeof parseMarkdownNote>,
  options: RunNotesMarkdownImportOptions,
  sleep: (ms: number) => Promise<void>,
): Promise<(string | null)[]> {
  const sources: (string | null)[] = [];
  for (const [index, image] of parsed.images.entries()) {
    const file = markdownImageFile(image, index);
    if (!file) {
      sources.push(null);
      continue;
    }
    try {
      const { nodeId } = await withRetry(
        () => options.operations.uploadImage(note, file, { signal: options.signal }),
        sleep,
        options.signal,
      );
      sources.push(toDriveFnSrc(nodeId));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (importErrorStatus(error) === 401) throw new SessionLostError();
      sources.push(null);
    }
  }
  return sources;
}

/**
 * After a failed body write: did it land anyway (the response was lost, then
 * the retry got 412)? A note whose stored body is no longer empty is kept;
 * deleting it would lose a saved import. Null when it is still empty or the
 * read failed.
 */
async function landedNote(
  note: Note,
  options: RunNotesMarkdownImportOptions,
): Promise<Note | null> {
  try {
    const stored = await options.operations.readBody(note, options.notebook, {
      signal: options.signal,
    });
    if (stored.body.trim() === "") return null;
    await options.operations.publishNote(stored.note);
    return stored.note;
  } catch {
    return null;
  }
}

async function importOneFile(
  file: File,
  options: RunNotesMarkdownImportOptions,
  result: NotesMarkdownImportResult,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const fileName = file.name;
  const read = await readMarkdownImportText(file);
  if (!read.ok) {
    result.skipped.push({ fileName, reason: read.reason });
    return;
  }
  const parsed = parseMarkdownNote(read.text, fileName);
  if (importedBodyByteLength(parsed) > NOTE_BODY_MAX_BYTES) {
    result.skipped.push({ fileName, reason: "bodyTooLarge" });
    return;
  }

  const { operations, notebook, signal } = options;
  let created: Note | null = null;
  let sources: (string | null)[] = [];
  let writingBody = false;
  const succeed = (note: Note) => {
    result.imported.push(note);
    options.onFileImported?.(file, note);
    for (const tag of parsed.droppedTags) {
      if (!result.droppedTags.includes(tag)) result.droppedTags.push(tag);
    }
    result.imagesNotImported +=
      parsed.relativeImageCount + sources.filter((src) => src === null).length;
  };
  try {
    created = await withRetry(
      () =>
        operations.createNote(
          {
            notebook,
            uid: options.uidFor(file),
            title: parsed.title,
            categories: parsed.tags,
          },
          { signal },
        ),
      sleep,
      signal,
    );
    const empty = created;
    sources = await uploadImages(empty, parsed, options, sleep);
    const body = finalizeImportedBody(parsed, sources);
    let note = empty;
    if (body.trim() !== "") {
      writingBody = true;
      note = await withRetry(
        () => operations.writeBody(empty, body, notebook, { signal }),
        sleep,
        signal,
      );
      writingBody = false;
    } else {
      await operations.publishNote(note);
    }
    succeed(note);
  } catch (error) {
    if (signal?.aborted) throw error;
    const status = importErrorStatus(error);
    const sessionLost = error instanceof SessionLostError || status === 401;
    if (created && writingBody && !sessionLost) {
      const landed = await landedNote(created, options);
      if (landed) {
        succeed(landed);
        return;
      }
    }
    // A file reported as skipped must not leave a half-made note behind.
    if (created) {
      try {
        await operations.deleteNote(created, { signal });
        options.releaseUid?.(file);
      } catch {
        // Best effort: the note stays, and a retry finds it by its uid.
      }
    }
    if (sessionLost) {
      result.skipped.push({ fileName, reason: "failed", status: 401 });
      throw new SessionLostError();
    }
    result.skipped.push({ fileName, reason: reasonForStatus(status), status });
  }
}

export async function runNotesMarkdownImport(
  options: RunNotesMarkdownImportOptions,
): Promise<NotesMarkdownImportResult> {
  const sleep = options.sleep ?? defaultSleep;
  const result: NotesMarkdownImportResult = {
    imported: [],
    skipped: [],
    droppedTags: [],
    imagesNotImported: 0,
  };
  const total = options.files.length;
  options.onProgress?.({ done: 0, total });
  for (const [index, file] of options.files.entries()) {
    try {
      await importOneFile(file, options, result, sleep);
    } catch (error) {
      if (!(error instanceof SessionLostError)) throw error;
      for (const rest of options.files.slice(index + 1)) {
        result.skipped.push({ fileName: rest.name, reason: "failed", status: 401 });
      }
      break;
    } finally {
      options.onProgress?.({ done: index + 1, total });
    }
  }
  return result;
}

/** Nothing to tell beyond the count: no skipped file, dropped tag or missing image. */
export function isCleanMarkdownImport(result: NotesMarkdownImportResult): boolean {
  return (
    result.skipped.length === 0 && result.droppedTags.length === 0 && result.imagesNotImported === 0
  );
}
