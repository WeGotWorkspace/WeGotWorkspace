export const VCF_FILE_ACCEPT = ".vcf,.vcard,text/vcard,text/x-vcard,application/vcard";

/**
 * Bytes per import POST. The server builds every created card in memory for
 * its answer, so a request's memory and time grow with its card count: 5,000
 * cards (~6 MB) took ~90 MB and ~16 s and died at a 128 MB `memory_limit`.
 * Small requests stay well inside shared-host limits.
 */
export const VCARD_IMPORT_BATCH_MAX_BYTES = 1024 * 1024;

/** Cards per import POST (~25 MB server memory, ~1 s locally). */
export const VCARD_IMPORT_BATCH_MAX_CARDS = 500;

/** Statuses where a smaller request may succeed: memory, time, or size limits and dropped connections. */
const RETRYABLE_IMPORT_STATUSES = new Set([0, 408, 413, 500, 502, 503, 504]);

/** Tries for a single card that keeps hitting a retryable failure. */
const SINGLE_CARD_ATTEMPTS = 3;

/** Failed requests in a row before the import stops, so a broken server is not flooded. */
const MAX_CONSECUTIVE_IMPORT_FAILURES = 8;

const IMPORT_RETRY_BASE_MS = 1_000;
const IMPORT_RETRY_MAX_MS = 15_000;

const CARD_SEPARATOR = "\n";

/** Whether a dropped/selected file is a vCard import candidate. */
export function isVcfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".vcf") ||
    name.endsWith(".vcard") ||
    file.type === "text/vcard" ||
    file.type === "text/x-vcard" ||
    file.type === "application/vcard"
  );
}

/** Keep only `.vcf` / `.vcard` / vCard MIME files from a file list. */
export function filterVcfFiles(fileList: FileList | null): File[] {
  return partitionVcfFiles(fileList).vcfFiles;
}

/** Split a selection into importable vCard files and skipped non-vCard files. */
export function partitionVcfFiles(fileList: FileList | null): {
  vcfFiles: File[];
  skippedCount: number;
} {
  if (!fileList || fileList.length === 0) {
    return { vcfFiles: [], skippedCount: 0 };
  }
  const all = Array.from(fileList);
  const vcfFiles = all.filter(isVcfFile);
  return { vcfFiles, skippedCount: all.length - vcfFiles.length };
}

/** Read one or more vCard files and concatenate their text (RFC 6350 multi-vCard). */
export async function readVcfFiles(files: File[]): Promise<string> {
  const texts = await Promise.all(files.map((file) => file.text()));
  return texts.join("\r\n");
}

export type VcfFileImportError = {
  fileName: string;
  message: string;
};

export type VcfImportResponseLike<TCard> = {
  list: TCard[];
  errors?: Array<{ index: number; message: string; code?: string }>;
};

export type VcfFilesImportAggregate<TCard> = {
  list: TCard[];
  fileErrors: VcfFileImportError[];
  blockErrors: number;
  blockErrorMessages: string[];
  importedFileCount: number;
  /** Cards a failed request created before it broke off; a retry found them in the book. */
  recoveredCount: number;
  /** Cards whose UID was already in the address book before this import. */
  alreadyExistingCount: number;
  /** Cards the server refused as too large. */
  tooLargeCount: number;
  /** Cards that were not imported: a request failed for good, or the import stopped. */
  failedCardCount: number;
};

export type VcardImportProgress = {
  importedCards: number;
  totalCards: number;
  batchIndex: number;
  batchCount: number;
};

export type VcardBatchPayload = {
  text: string;
  cardCount: number;
  blocks: string[];
};

export type ImportVcfFilesBatchOptions = {
  maxBatchBytes?: number;
  maxBatchCards?: number;
  onProgress?: (progress: VcardImportProgress) => void;
  /** Pause before a retry. Tests pass a no-op. */
  wait?: (ms: number) => Promise<void>;
};

export const VCARD_IMPORT_CARD_TOO_LARGE =
  "A single contact is larger than the server upload limit and cannot be split.";

export const VCARD_IMPORT_FAILED_FALLBACK = "Import failed.";

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const CARD_BEGIN = /^BEGIN:VCARD\s*$/i;
const CARD_END = /^END:VCARD\s*$/i;
const STUB_CARD_PROP = /^(VERSION|PRODID)[:;]/i;

const LEFTOVER_IMPORT_ERROR_MESSAGES = new Set(["invalid vcard block.", "no vcard data found."]);

/** True when the API reported leftover/junk text rather than a real card failure. */
export function isLeftoverImportErrorMessage(message: string): boolean {
  return LEFTOVER_IMPORT_ERROR_MESSAGES.has(message.trim().toLowerCase());
}

function isImportableVcardBlock(lines: string[]): boolean {
  if (lines.length < 2) return false;
  if (!CARD_BEGIN.test(lines[0] ?? "") || !CARD_END.test(lines[lines.length - 1] ?? "")) {
    return false;
  }
  const interior = lines
    .slice(1, -1)
    .map((line) => line.trim())
    .filter(Boolean);
  if (interior.length === 0) return false;
  return !interior.every((line) => STUB_CARD_PROP.test(line));
}

/** True when the payload is at least one complete, importable `BEGIN:VCARD` … `END:VCARD`. */
export function isCompleteVcardDocument(text: string): boolean {
  if (splitVcardBlocks(text).length === 0) return false;
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return CARD_BEGIN.test(lines[0] ?? "") && CARD_END.test(lines[lines.length - 1] ?? "");
}

/**
 * Split a vCard file into individual `BEGIN:VCARD` … `END:VCARD` blocks.
 * Only treats `BEGIN:VCARD` / `END:VCARD` at line start so folded PHOTO,
 * quoted-printable `=` continuations, and a NOTE mentioning BEGIN:VCARD
 * stay inside the current card. File-level prelude (Apple/Google headers),
 * orphan `END:VCARD`, empty/stub tail cards, and a truncated last card
 * are omitted so every packed batch is a complete vCard document.
 */
export function splitVcardBlocks(input: string): string[] {
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of normalized.split("\n")) {
    if (current === null) {
      if (CARD_BEGIN.test(line)) {
        current = [line];
      }
      continue;
    }
    current.push(line);
    if (CARD_END.test(line)) {
      if (isImportableVcardBlock(current)) {
        blocks.push(current.join("\n"));
      }
      current = null;
    }
  }

  return blocks;
}

/** Pack vCard blocks into payloads that stay under `maxBytes` and `maxCards`. */
export function packVcardBlocks(
  blocks: string[],
  maxBytes: number,
  maxCards: number = Number.POSITIVE_INFINITY,
): { batches: VcardBatchPayload[]; oversizedCount: number } {
  const batches: VcardBatchPayload[] = [];
  let current: string[] = [];
  let currentBytes = 0;
  let oversizedCount = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({
      text: current.join(CARD_SEPARATOR),
      cardCount: current.length,
      blocks: current,
    });
    current = [];
    currentBytes = 0;
  };

  for (const block of blocks) {
    const bytes = utf8ByteLength(block);
    if (bytes > maxBytes) {
      oversizedCount += 1;
      continue;
    }
    const extra = current.length === 0 ? 0 : utf8ByteLength(CARD_SEPARATOR);
    if (
      current.length > 0 &&
      (currentBytes + extra + bytes > maxBytes || current.length >= maxCards)
    ) {
      flush();
    }
    const sep = current.length === 0 ? 0 : utf8ByteLength(CARD_SEPARATOR);
    current.push(block);
    currentBytes += sep + bytes;
  }
  flush();

  return { batches, oversizedCount };
}

/** Plan POST payloads for one vCard file. Only complete cards are sent — never prelude or leftover tail. */
export function planVcardFileBatches(
  text: string,
  maxBytes: number = VCARD_IMPORT_BATCH_MAX_BYTES,
  maxCards: number = VCARD_IMPORT_BATCH_MAX_CARDS,
): { batches: VcardBatchPayload[]; oversizedCount: number } {
  const blocks = splitVcardBlocks(text);
  if (blocks.length === 0) {
    return { batches: [], oversizedCount: 0 };
  }
  return packVcardBlocks(blocks, maxBytes, maxCards);
}

/** Prefer Error.message (API/client reason); keep a short fallback when nothing useful was sent. */
export function importErrorMessageFromUnknown(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

/** One user-facing summary from file/batch failures and per-card parse errors. */
export function summarizeVcfImportErrors(
  fileErrors: VcfFileImportError[],
  blockMessages: string[],
  fallback: string,
): string {
  const parts: string[] = [];
  if (fileErrors.length === 1) {
    parts.push(fileErrors[0]!.message);
  } else if (fileErrors.length > 1) {
    parts.push(...fileErrors.map((error) => `${error.fileName}: ${error.message}`));
  }
  const uniqueBlocks = [...new Set(blockMessages.map((message) => message.trim()).filter(Boolean))];
  if (uniqueBlocks.length > 0) {
    parts.push(uniqueBlocks.join(" "));
  }
  return parts.join(" ").trim() || fallback;
}

export type VcfImportOutcomeCounts = {
  alreadyExisting?: number;
  tooLarge?: number;
  failedCards?: number;
};

const contactsNoun = (count: number): string => (count === 1 ? "contact" : "contacts");

/**
 * Single import outcome: success, success with a note (cards already in the
 * book), or one combined failure message. Counts every card, so the message
 * never reports fewer imports than the book holds.
 */
export function summarizeVcfImportOutcome(
  importedCount: number,
  fileErrors: VcfFileImportError[],
  blockMessages: string[],
  fallback: string,
  counts: VcfImportOutcomeCounts = {},
): { failed: boolean; message: string | null } {
  const alreadyExisting = counts.alreadyExisting ?? 0;
  const tooLarge = counts.tooLarge ?? 0;
  const failedCards = counts.failedCards ?? 0;
  const hasErrors = fileErrors.length > 0 || blockMessages.length > 0;
  const failed = hasErrors || tooLarge > 0 || failedCards > 0;
  if (!failed && alreadyExisting === 0) {
    return { failed: false, message: null };
  }

  const parts: string[] = [];
  if (importedCount > 0) {
    parts.push(`Imported ${importedCount} ${contactsNoun(importedCount)}.`);
  }
  if (alreadyExisting > 0) {
    parts.push(
      `${alreadyExisting} ${alreadyExisting === 1 ? "was" : "were"} already in this address book.`,
    );
  }
  if (tooLarge > 0) {
    parts.push(
      `${tooLarge} ${tooLarge === 1 ? "contact is" : "contacts are"} too large to import.`,
    );
  }
  // The count only helps next to what did go in; on a total failure the reason says it.
  if (failedCards > 0 && parts.length > 0) {
    parts.push(`${failedCards} ${contactsNoun(failedCards)} could not be imported.`);
  }
  if (hasErrors) {
    parts.push(summarizeVcfImportErrors(fileErrors, blockMessages, fallback));
  }
  return { failed, message: parts.join(" ").trim() || fallback };
}

type QueuedVcardBatch = {
  blocks: string[];
  /** Resent after a failed request, so cards it finds "already existing" are its own. */
  retry: boolean;
  attempts: number;
};

function importFailureStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A smaller or later request may succeed: server limits, timeouts, or a dropped connection while online. */
function isRetryableImportFailure(error: unknown): boolean {
  const status = importFailureStatus(error);
  if (status === undefined || !RETRYABLE_IMPORT_STATUSES.has(status)) return false;
  return !(status === 0 && browserIsOffline());
}

function importRetryDelayMs(consecutiveFailures: number): number {
  return Math.min(
    IMPORT_RETRY_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    IMPORT_RETRY_MAX_MS,
  );
}

const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function splitIntoChunks(blocks: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < blocks.length; start += size) {
    chunks.push(blocks.slice(start, start + size));
  }
  return chunks;
}

export const VCARD_IMPORT_STOPPED =
  "The import stopped because the server kept failing. Import the same file again to add the rest; contacts already imported are skipped.";

/**
 * Import each vCard file in small batches and aggregate results.
 * A batch that hits a server limit (memory, time, size) or a dropped
 * connection is halved and resent, and later batches stay at that size.
 * Cards a broken request already created come back as `alreadyExists` on the
 * resend and count as imported. After repeated failures the import stops
 * rather than flooding the server. Keeps successful imports when one file or
 * batch in a multi-select fails.
 */
export async function importVcfFilesBatch<TCard>(
  files: File[],
  importOne: (vcardText: string) => Promise<VcfImportResponseLike<TCard>>,
  options?: ImportVcfFilesBatchOptions,
): Promise<VcfFilesImportAggregate<TCard>> {
  const maxBatchBytes = options?.maxBatchBytes ?? VCARD_IMPORT_BATCH_MAX_BYTES;
  const maxBatchCards = options?.maxBatchCards ?? VCARD_IMPORT_BATCH_MAX_CARDS;
  const onProgress = options?.onProgress;
  const wait = options?.wait ?? waitMs;

  const planned = await Promise.all(
    files.map(async (file) => {
      const text = await file.text();
      if (text.trim() === "") {
        return {
          fileName: file.name,
          batches: [] as VcardBatchPayload[],
          oversizedCount: 0,
          empty: true,
        };
      }
      const plan = planVcardFileBatches(text, maxBatchBytes, maxBatchCards);
      return {
        fileName: file.name,
        batches: plan.batches,
        oversizedCount: plan.oversizedCount,
        empty: false,
      };
    }),
  );

  const totalCards = planned.reduce(
    (sum, item) => sum + item.batches.reduce((inner, batch) => inner + batch.cardCount, 0),
    0,
  );
  let pendingBatches = planned.reduce((sum, item) => sum + item.batches.length, 0);

  const list: TCard[] = [];
  const fileErrors: VcfFileImportError[] = [];
  const blockErrorMessages: string[] = [];
  let blockErrors = 0;
  let importedFileCount = 0;
  let importedCards = 0;
  let completedBatches = 0;
  let recoveredCount = 0;
  let alreadyExistingCount = 0;
  let tooLargeCount = 0;
  let failedCardCount = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  let cardCap = maxBatchCards;

  const batchCount = (): number => completedBatches + pendingBatches;
  const report = (nextBatchIndex: number): void => {
    const count = batchCount();
    onProgress?.({
      importedCards,
      totalCards,
      batchIndex: count === 0 ? 0 : Math.min(nextBatchIndex, count),
      batchCount: count,
    });
  };

  if (pendingBatches > 0) {
    report(1);
  }

  for (const item of planned) {
    if (item.empty) {
      fileErrors.push({ fileName: item.fileName, message: "Empty file." });
      continue;
    }
    if (item.oversizedCount > 0) {
      fileErrors.push({ fileName: item.fileName, message: VCARD_IMPORT_CARD_TOO_LARGE });
    }
    if (item.batches.length === 0) {
      if (item.oversizedCount === 0) {
        fileErrors.push({ fileName: item.fileName, message: "No vCard data found." });
      }
      continue;
    }

    let fileImported = false;
    const fileThrowReasons: string[] = [];
    const seenReasons = new Set<string>();
    let fileApiBlockErrors = 0;
    let fileCardOutcomes = 0;
    const queue: QueuedVcardBatch[] = item.batches.map((batch) => ({
      blocks: batch.blocks,
      retry: false,
      attempts: 0,
    }));

    const failFile = (reason: string, batchIndex: number): void => {
      if (seenReasons.has(reason)) return;
      seenReasons.add(reason);
      fileThrowReasons.push(
        batchCount() > 1 ? `Batch ${batchIndex} of ${batchCount()}: ${reason}` : reason,
      );
    };

    while (queue.length > 0) {
      // The batch in hand still counts as pending until it settles.
      const batch = queue.shift()!;
      if (stopped) {
        pendingBatches -= 1;
        failedCardCount += batch.blocks.length;
        if (!seenReasons.has(VCARD_IMPORT_STOPPED)) {
          seenReasons.add(VCARD_IMPORT_STOPPED);
          fileThrowReasons.push(VCARD_IMPORT_STOPPED);
        }
        continue;
      }
      if (batch.blocks.length > cardCap) {
        const chunks = splitIntoChunks(batch.blocks, cardCap);
        queue.unshift(...chunks.map((blocks) => ({ blocks, retry: batch.retry, attempts: 0 })));
        pendingBatches += chunks.length - 1;
        continue;
      }
      const text = batch.blocks.join(CARD_SEPARATOR);
      if (batch.blocks.length === 0 || !isCompleteVcardDocument(text)) {
        pendingBatches -= 1;
        continue;
      }
      const batchIndex = completedBatches + 1;
      report(batchIndex);
      try {
        const result = await importOne(text);
        consecutiveFailures = 0;
        const batchBlockErrors = result.errors ?? [];
        const leftoverOnly =
          batchBlockErrors.length > 0 &&
          batchBlockErrors.every((block) => isLeftoverImportErrorMessage(block.message));
        const ignoreLeftover = leftoverOnly && result.list.length >= batch.blocks.length;
        let batchRecovered = 0;
        if (!ignoreLeftover) {
          for (const block of batchBlockErrors) {
            if (block.code === "alreadyExists") {
              fileCardOutcomes += 1;
              if (batch.retry) {
                batchRecovered += 1;
              } else {
                alreadyExistingCount += 1;
              }
              continue;
            }
            if (block.code === "payload_too_large") {
              fileCardOutcomes += 1;
              tooLargeCount += 1;
              continue;
            }
            fileApiBlockErrors += 1;
            if (block.message.trim()) {
              blockErrorMessages.push(block.message.trim());
            }
          }
        }
        recoveredCount += batchRecovered;
        importedCards += batchRecovered;
        if (result.list.length > 0 || batchRecovered > 0) {
          fileImported = true;
          list.push(...result.list);
          importedCards += result.list.length;
        } else if (batchBlockErrors.length === 0) {
          // 2xx empty / non-JSON text: request was accepted; don't abort later batches.
          fileImported = true;
        }
      } catch (error) {
        consecutiveFailures += 1;
        const reason = importErrorMessageFromUnknown(error, VCARD_IMPORT_FAILED_FALLBACK);
        const retryable = isRetryableImportFailure(error);
        if (retryable && consecutiveFailures < MAX_CONSECUTIVE_IMPORT_FAILURES) {
          if (batch.blocks.length > 1) {
            const half = Math.ceil(batch.blocks.length / 2);
            cardCap = Math.min(cardCap, half);
            queue.unshift(
              { blocks: batch.blocks.slice(0, half), retry: true, attempts: 0 },
              { blocks: batch.blocks.slice(half), retry: true, attempts: 0 },
            );
            pendingBatches += 1;
            await wait(importRetryDelayMs(consecutiveFailures));
            continue;
          }
          if (batch.attempts + 1 < SINGLE_CARD_ATTEMPTS) {
            queue.unshift({ blocks: batch.blocks, retry: true, attempts: batch.attempts + 1 });
            await wait(importRetryDelayMs(consecutiveFailures));
            continue;
          }
        }
        failedCardCount += batch.blocks.length;
        if (retryable && consecutiveFailures >= MAX_CONSECUTIVE_IMPORT_FAILURES) {
          stopped = true;
          failFile(`${reason} ${VCARD_IMPORT_STOPPED}`, batchIndex);
          seenReasons.add(VCARD_IMPORT_STOPPED);
        } else if (!(importedCards > 0 && isLeftoverImportErrorMessage(reason))) {
          failFile(reason, batchIndex);
        }
      }
      pendingBatches -= 1;
      completedBatches += 1;
      report(completedBatches + 1);
    }

    if (fileImported) importedFileCount += 1;
    blockErrors += fileApiBlockErrors;
    if (fileThrowReasons.length > 0) {
      fileErrors.push({ fileName: item.fileName, message: fileThrowReasons.join(" ") });
    } else if (
      !fileImported &&
      item.oversizedCount === 0 &&
      fileApiBlockErrors === 0 &&
      fileCardOutcomes === 0
    ) {
      fileErrors.push({ fileName: item.fileName, message: "No vCard data found." });
    }
  }

  return {
    list,
    fileErrors,
    blockErrors,
    blockErrorMessages,
    importedFileCount,
    recoveredCount,
    alreadyExistingCount,
    tooLargeCount,
    failedCardCount,
  };
}
