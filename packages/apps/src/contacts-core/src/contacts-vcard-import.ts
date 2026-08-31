export const VCF_FILE_ACCEPT = ".vcf,.vcard,text/vcard,text/x-vcard,application/vcard";

/**
 * Stay under the aligned 32M PHP `post_max_size` (see `docker/php/uploads.ini`).
 * Raw `text/vcard` POST body — leave headroom for headers / encoding.
 */
export const VCARD_IMPORT_BATCH_MAX_BYTES = 28 * 1024 * 1024;

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
  errors?: Array<{ index: number; message: string }>;
};

export type VcfFilesImportAggregate<TCard> = {
  list: TCard[];
  fileErrors: VcfFileImportError[];
  blockErrors: number;
  blockErrorMessages: string[];
  importedFileCount: number;
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
};

export type ImportVcfFilesBatchOptions = {
  maxBatchBytes?: number;
  onProgress?: (progress: VcardImportProgress) => void;
};

export const VCARD_IMPORT_CARD_TOO_LARGE =
  "A single contact is larger than the server upload limit and cannot be split.";

export const VCARD_IMPORT_FAILED_FALLBACK = "Import failed.";

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Split a vCard file into individual `BEGIN:VCARD` … `END:VCARD` blocks.
 * Mirrors server-side ContactCardVcfImportSupport::splitVcards.
 */
export function splitVcardBlocks(input: string): string[] {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split(/(?=BEGIN:VCARD)/i).filter((part) => part.trim() !== "");
  const blocks: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!trimmed.toUpperCase().includes("END:VCARD")) continue;
    blocks.push(trimmed);
  }

  return blocks;
}

/** Pack vCard blocks into payloads that stay under `maxBytes`. */
export function packVcardBlocks(
  blocks: string[],
  maxBytes: number,
): { batches: VcardBatchPayload[]; oversizedCount: number } {
  const batches: VcardBatchPayload[] = [];
  let current: string[] = [];
  let currentBytes = 0;
  let oversizedCount = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({ text: current.join(CARD_SEPARATOR), cardCount: current.length });
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
    if (current.length > 0 && currentBytes + extra + bytes > maxBytes) {
      flush();
    }
    const sep = current.length === 0 ? 0 : utf8ByteLength(CARD_SEPARATOR);
    current.push(block);
    currentBytes += sep + bytes;
  }
  flush();

  return { batches, oversizedCount };
}

/** Plan POST payloads for one vCard file. Small files stay a single original-text request. */
export function planVcardFileBatches(
  text: string,
  maxBytes: number = VCARD_IMPORT_BATCH_MAX_BYTES,
): { batches: VcardBatchPayload[]; oversizedCount: number } {
  const blocks = splitVcardBlocks(text);
  if (blocks.length === 0) {
    return { batches: [], oversizedCount: 0 };
  }
  if (utf8ByteLength(text) <= maxBytes) {
    return { batches: [{ text, cardCount: blocks.length }], oversizedCount: 0 };
  }
  return packVcardBlocks(blocks, maxBytes);
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

/**
 * Import each vCard file (chunked under the POST cap) and aggregate results.
 * Keeps successful imports when one file or batch in a multi-select fails.
 */
export async function importVcfFilesBatch<TCard>(
  files: File[],
  importOne: (vcardText: string) => Promise<VcfImportResponseLike<TCard>>,
  options?: ImportVcfFilesBatchOptions,
): Promise<VcfFilesImportAggregate<TCard>> {
  const maxBatchBytes = options?.maxBatchBytes ?? VCARD_IMPORT_BATCH_MAX_BYTES;
  const onProgress = options?.onProgress;

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
      const plan = planVcardFileBatches(text, maxBatchBytes);
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
  const batchCount = planned.reduce((sum, item) => sum + item.batches.length, 0);

  const list: TCard[] = [];
  const fileErrors: VcfFileImportError[] = [];
  const blockErrorMessages: string[] = [];
  let blockErrors = 0;
  let importedFileCount = 0;
  let importedCards = 0;
  let completedBatches = 0;

  const report = (nextBatchIndex: number): void => {
    onProgress?.({
      importedCards,
      totalCards,
      batchIndex: batchCount === 0 ? 0 : nextBatchIndex,
      batchCount,
    });
  };

  if (batchCount > 0) {
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
    let fileThrowReason: string | null = null;
    let fileApiBlockErrors = 0;

    for (const batch of item.batches) {
      const batchIndex = completedBatches + 1;
      report(batchIndex);
      try {
        const result = await importOne(batch.text);
        const batchBlockErrors = result.errors ?? [];
        fileApiBlockErrors += batchBlockErrors.length;
        for (const block of batchBlockErrors) {
          if (block.message.trim()) {
            blockErrorMessages.push(block.message.trim());
          }
        }
        if (result.list.length > 0) {
          fileImported = true;
          list.push(...result.list);
          importedCards += result.list.length;
        }
      } catch (error) {
        const reason = importErrorMessageFromUnknown(error, VCARD_IMPORT_FAILED_FALLBACK);
        const labeled = batchCount > 1 ? `Batch ${batchIndex} of ${batchCount}: ${reason}` : reason;
        fileThrowReason = fileThrowReason ? `${fileThrowReason} ${labeled}` : labeled;
      }
      completedBatches += 1;
      report(Math.min(completedBatches + 1, batchCount));
    }

    if (fileImported) importedFileCount += 1;
    blockErrors += fileApiBlockErrors;
    if (fileThrowReason) {
      fileErrors.push({ fileName: item.fileName, message: fileThrowReason });
    } else if (!fileImported && item.oversizedCount === 0 && fileApiBlockErrors === 0) {
      fileErrors.push({ fileName: item.fileName, message: "No vCard data found." });
    }
  }

  return { list, fileErrors, blockErrors, blockErrorMessages, importedFileCount };
}
