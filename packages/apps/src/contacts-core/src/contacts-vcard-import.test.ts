import { describe, expect, it, vi } from "vitest";
import {
  filterVcfFiles,
  importVcfFilesBatch,
  isVcfFile,
  packVcardBlocks,
  partitionVcfFiles,
  planVcardFileBatches,
  readVcfFiles,
  splitVcardBlocks,
  summarizeVcfImportErrors,
  summarizeVcfImportOutcome,
  utf8ByteLength,
  VCARD_IMPORT_BATCH_MAX_BYTES,
  VCARD_IMPORT_CARD_TOO_LARGE,
} from "@/contacts-core/src/contacts-vcard-import";

describe("isVcfFile", () => {
  it("accepts .vcf/.vcard extensions and vCard MIME types", () => {
    expect(isVcfFile(new File(["x"], "contacts.vcf"))).toBe(true);
    expect(isVcfFile(new File(["x"], "contacts.VCF"))).toBe(true);
    expect(isVcfFile(new File(["x"], "contacts.vcard"))).toBe(true);
    expect(isVcfFile(new File(["x"], "contacts.txt", { type: "text/vcard" }))).toBe(true);
    expect(isVcfFile(new File(["x"], "contacts.txt", { type: "text/x-vcard" }))).toBe(true);
  });

  it("rejects non-vCard files", () => {
    expect(isVcfFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("filterVcfFiles", () => {
  it("keeps only vCard files", () => {
    const list = {
      0: new File(["a"], "one.vcf"),
      1: new File(["b"], "two.txt", { type: "text/plain" }),
      2: new File(["c"], "three.vcard"),
      length: 3,
      item(index: number) {
        return this[index as 0 | 1 | 2];
      },
      [Symbol.iterator]() {
        return [this[0], this[1], this[2]][Symbol.iterator]();
      },
    } as FileList;

    expect(filterVcfFiles(list).map((file) => file.name)).toEqual(["one.vcf", "three.vcard"]);
  });
});

describe("partitionVcfFiles", () => {
  it("returns skipped count for mixed selections", () => {
    const list = {
      0: new File(["a"], "one.vcf"),
      1: new File(["b"], "notes.txt", { type: "text/plain" }),
      2: new File(["c"], "two.vcf"),
      length: 3,
      item(index: number) {
        return this[index as 0 | 1 | 2];
      },
      [Symbol.iterator]() {
        return [this[0], this[1], this[2]][Symbol.iterator]();
      },
    } as FileList;

    expect(partitionVcfFiles(list)).toEqual({
      vcfFiles: [list[0], list[2]],
      skippedCount: 1,
    });
  });
});

describe("readVcfFiles", () => {
  it("concatenates multiple files", async () => {
    const files = [
      new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf"),
      new File(["BEGIN:VCARD\nFN:Two\nEND:VCARD"], "two.vcf"),
    ];
    const text = await readVcfFiles(files);
    expect(text).toContain("FN:One");
    expect(text).toContain("FN:Two");
  });
});

describe("importVcfFilesBatch", () => {
  it("imports each file separately and aggregates contacts", async () => {
    const importOne = vi
      .fn()
      .mockResolvedValueOnce({
        list: [{ id: "card-one", name: { full: "One" } }],
        errors: [],
      })
      .mockResolvedValueOnce({
        list: [{ id: "card-two", name: { full: "Two" } }],
        errors: [],
      });

    const files = [
      new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf"),
      new File(["BEGIN:VCARD\nFN:Two\nEND:VCARD"], "two.vcf"),
    ];

    const result = await importVcfFilesBatch(files, importOne);

    expect(importOne).toHaveBeenCalledTimes(2);
    expect(result.list).toHaveLength(2);
    expect(result.importedFileCount).toBe(2);
    expect(result.fileErrors).toEqual([]);
  });

  it("keeps successful files when another file fails", async () => {
    const importOne = vi
      .fn()
      .mockResolvedValueOnce({
        list: [{ id: "card-one", name: { full: "One" } }],
        errors: [],
      })
      .mockRejectedValueOnce(new Error("network"));

    const files = [
      new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf"),
      new File(["BEGIN:VCARD\nFN:Two\nEND:VCARD"], "bad.vcf"),
    ];

    const result = await importVcfFilesBatch(files, importOne);

    expect(result.list).toHaveLength(1);
    expect(result.fileErrors).toEqual([{ fileName: "bad.vcf", message: "Batch 2 of 2: network" }]);
  });

  it("keeps the API/client reason when a batch fails", async () => {
    const importOne = vi
      .fn()
      .mockRejectedValue(new Error("Upload too large. Current server post_max_size is 8M."));

    const result = await importVcfFilesBatch(
      [new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "big.vcf")],
      importOne,
    );

    expect(result.fileErrors).toEqual([
      {
        fileName: "big.vcf",
        message: "Upload too large. Current server post_max_size is 8M.",
      },
    ]);
  });

  it("labels which batch failed on a multi-batch file", async () => {
    const one = card("One", 20);
    const two = card("Two", 20);
    const text = [one, two].join("\n");
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two)) + 4;
    const importOne = vi
      .fn()
      .mockResolvedValueOnce({ list: [{ id: "ok" }], errors: [] })
      .mockRejectedValueOnce(new Error("Forbidden."));

    const result = await importVcfFilesBatch([new File([text], "contacts.vcf")], importOne, {
      maxBatchBytes: maxBytes,
    });

    expect(result.list).toHaveLength(1);
    expect(result.fileErrors[0]?.message).toMatch(/Batch 2 of \d+: Forbidden\./);
  });

  it("surfaces per-card parse errors instead of a generic failure", async () => {
    const importOne = vi.fn().mockResolvedValue({
      list: [],
      errors: [{ index: 0, message: "Invalid vCard block." }],
    });

    const result = await importVcfFilesBatch(
      [new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "bad.vcf")],
      importOne,
    );

    expect(result.blockErrorMessages).toEqual(["Invalid vCard block."]);
    expect(summarizeVcfImportErrors(result.fileErrors, result.blockErrorMessages, "fallback")).toBe(
      "Invalid vCard block.",
    );
    expect(
      summarizeVcfImportOutcome(0, result.fileErrors, result.blockErrorMessages, "fallback"),
    ).toEqual({ failed: true, message: "Invalid vCard block." });
  });

  it("combines a partial import with the batch failure into one message", () => {
    expect(
      summarizeVcfImportOutcome(
        647,
        [{ fileName: "contacts.vcf", message: "Batch 2 of 2: Forbidden." }],
        [],
        "fallback",
      ),
    ).toEqual({
      failed: true,
      message: "Imported 647 contacts. Batch 2 of 2: Forbidden.",
    });
  });

  it("does not POST leftover tail and ignores leftover Invalid vCard block after success", async () => {
    const one = card("One", 20);
    const two = card("Two", 20);
    const text = `# exported from Apple Contacts\n${one}\n${two}\nEND:VCARD\n# footer\nBEGIN:VCARD\n`;
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two)) + 4;
    const importOne = vi.fn().mockImplementation((vcardText: string) => {
      const blocks = splitVcardBlocks(vcardText);
      if (blocks.length === 0) {
        return Promise.resolve({
          list: [],
          errors: [{ index: 0, message: "Invalid vCard block." }],
        });
      }
      return Promise.resolve({
        list: blocks.map((block, index) => ({ id: `card-${index}`, block })),
        errors: [],
      });
    });

    const result = await importVcfFilesBatch([new File([text], "contacts.vcf")], importOne, {
      maxBatchBytes: maxBytes,
    });

    expect(importOne.mock.calls.length).toBeGreaterThan(0);
    for (const [payload] of importOne.mock.calls) {
      assertValidVcardDocument(payload as string);
      expect(payload).not.toContain("# exported");
      expect(payload).not.toContain("# footer");
    }
    expect(result.list).toHaveLength(2);
    expect(result.fileErrors).toEqual([]);
    expect(result.blockErrors).toBe(0);
    expect(result.blockErrorMessages).toEqual([]);
  });

  it("ignores leftover Invalid vCard block when the batch already imported its cards", async () => {
    const importOne = vi.fn().mockResolvedValue({
      list: [{ id: "card-one" }, { id: "card-two" }],
      errors: [{ index: 2, message: "Invalid vCard block." }],
    });

    const result = await importVcfFilesBatch(
      [new File([`${card("One")}\n${card("Two")}\nEND:VCARD\n# footer\n`], "contacts.vcf")],
      importOne,
    );

    expect(importOne).toHaveBeenCalledTimes(1);
    assertValidVcardDocument(importOne.mock.calls[0]![0] as string);
    expect(result.list).toHaveLength(2);
    expect(result.blockErrors).toBe(0);
    expect(result.blockErrorMessages).toEqual([]);
    expect(result.fileErrors).toEqual([]);
  });
});

describe("splitVcardBlocks", () => {
  it("splits multiple cards in one file", () => {
    const input = `BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Joe Example
END:VCARD`;

    const blocks = splitVcardBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("FN:Jane Doe");
    expect(blocks[1]).toContain("FN:Joe Example");
  });

  it("ignores incomplete blocks", () => {
    expect(splitVcardBlocks("BEGIN:VCARD\nFN:Broken\n")).toEqual([]);
  });

  it("skips prelude, orphan END:VCARD, empty tail cards, and truncated leftovers", () => {
    const input = `# exported from Google
BEGIN:VCARD
FN:Jane
END:VCARD
END:VCARD
BEGIN:VCARD
END:VCARD
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBook
END:VCARD
# footer
BEGIN:VCARD
FN:Truncated
`;

    const blocks = splitVcardBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("FN:Jane");
    expect(blocks.every((block) => /FN:Jane/.test(block))).toBe(true);
  });

  it("does not treat BEGIN:VCARD inside a NOTE as a new card", () => {
    const input = `BEGIN:VCARD
FN:Jane
NOTE:See BEGIN:VCARD in the spec
END:VCARD
BEGIN:VCARD
FN:Joe
END:VCARD`;

    const blocks = splitVcardBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("NOTE:See BEGIN:VCARD in the spec");
    expect(blocks[0]).toMatch(/^BEGIN:VCARD/i);
    expect(blocks[0]).toMatch(/END:VCARD$/i);
    expect(blocks[1]).toContain("FN:Joe");
  });

  it("keeps folded PHOTO and quoted-printable inside one card", () => {
    const photo = foldedPhotoCard("Pix", 200);
    const qp = [
      "BEGIN:VCARD",
      "FN:Qp",
      "NOTE;ENCODING=QUOTED-PRINTABLE:hello=",
      " world",
      "END:VCARD",
    ].join("\n");

    const blocks = splitVcardBlocks(`${photo}\n${qp}`);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("PHOTO;ENCODING=b");
    expect(blocks[0]).toContain("AAAA");
    expect((blocks[0].match(/^BEGIN:VCARD\s*$/gim) ?? []).length).toBe(1);
    expect((blocks[0].match(/^END:VCARD\s*$/gim) ?? []).length).toBe(1);
    expect(blocks[1]).toContain("hello=");
    expect(blocks[1]).toContain(" world");
  });
});

function card(name: string, pad = 0): string {
  const note = pad > 0 ? `\nNOTE:${"x".repeat(pad)}` : "";
  return `BEGIN:VCARD\nFN:${name}${note}\nEND:VCARD`;
}

/** RFC 6350 fold: 75-octet lines, continuation begins with a space. */
function foldVcardLine(line: string, limit = 75): string {
  if (line.length <= limit) return line;
  const parts = [line.slice(0, limit)];
  for (let index = limit; index < line.length; index += limit - 1) {
    parts.push(` ${line.slice(index, index + limit - 1)}`);
  }
  return parts.join("\n");
}

function foldedPhotoCard(name: string, photoChars: number): string {
  const folded = foldVcardLine(`PHOTO;ENCODING=b;TYPE=JPEG:${"A".repeat(photoChars)}`);
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\n${folded}\nEND:VCARD`;
}

function assertValidVcardDocument(text: string): void {
  expect(text.trim()).toMatch(/^BEGIN:VCARD/i);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let open = 0;
  let cards = 0;
  for (const line of lines) {
    if (/^BEGIN:VCARD\s*$/i.test(line)) {
      expect(open).toBe(0);
      open = 1;
    } else if (/^END:VCARD\s*$/i.test(line)) {
      expect(open).toBe(1);
      open = 0;
      cards += 1;
    }
  }
  expect(open).toBe(0);
  expect(cards).toBeGreaterThan(0);
}

describe("planVcardFileBatches", () => {
  it("keeps a small file as one complete-card payload", () => {
    const text = card("One");
    const plan = planVcardFileBatches(text, 1024);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.text).toBe(text);
    expect(plan.batches[0]?.cardCount).toBe(1);
    expect(plan.oversizedCount).toBe(0);
    assertValidVcardDocument(plan.batches[0]!.text);
  });

  it("does not emit a leftover batch for prelude, trailing garbage, or empty tail cards", () => {
    const one = card("One");
    const two = card("Two");
    const text = `# exported from Apple Contacts\n${one}\n${two}\nEND:VCARD\nBEGIN:VCARD\nEND:VCARD\n# footer\n`;
    const plan = planVcardFileBatches(text, 64 * 1024);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.cardCount).toBe(2);
    assertValidVcardDocument(plan.batches[0]!.text);
    expect(plan.batches[0]!.text).not.toContain("# exported");
    expect(plan.batches[0]!.text).not.toContain("# footer");
    expect(plan.batches[0]!.text).toContain("FN:One");
    expect(plan.batches[0]!.text).toContain("FN:Two");
  });

  it("splits a multi-card file into payloads under the cap", () => {
    const one = card("One", 20);
    const two = card("Two", 20);
    const three = card("Three", 20);
    const text = [one, two, three].join("\n");
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two), utf8ByteLength(three)) + 4;
    expect(utf8ByteLength(text)).toBeGreaterThan(maxBytes);

    const plan = planVcardFileBatches(text, maxBytes);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.reduce((sum, batch) => sum + batch.cardCount, 0)).toBe(3);
    for (const batch of plan.batches) {
      expect(utf8ByteLength(batch.text)).toBeLessThanOrEqual(maxBytes);
    }
    expect(plan.oversizedCount).toBe(0);
  });

  it("defaults under live 8M PHP so an 11MB file becomes multiple POSTs", () => {
    expect(VCARD_IMPORT_BATCH_MAX_BYTES).toBe(6 * 1024 * 1024);
    const cards = Array.from({ length: 12 }, (_, index) => card(`N${index}`, 1_000_000));
    const text = cards.join("\n");
    expect(utf8ByteLength(text)).toBeGreaterThan(11 * 1024 * 1024);
    const plan = planVcardFileBatches(text);
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(utf8ByteLength(batch.text)).toBeLessThanOrEqual(VCARD_IMPORT_BATCH_MAX_BYTES);
    }
    expect(plan.oversizedCount).toBe(0);
  });

  it("flags a single card larger than the cap", () => {
    const huge = card("Huge", 80);
    const packed = packVcardBlocks([huge], 40);
    expect(packed.batches).toEqual([]);
    expect(packed.oversizedCount).toBe(1);
    expect(utf8ByteLength(huge)).toBeGreaterThan(40);
  });

  it("omits a file-level prelude so packed batches stay valid vCards", () => {
    const one = card("One", 40);
    const two = card("Two", 40);
    const text = `# exported from Apple Contacts\n${one}\n${two}`;
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two)) + 4;
    expect(utf8ByteLength(text)).toBeGreaterThan(maxBytes);

    const plan = planVcardFileBatches(text, maxBytes);
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(batch.text).not.toContain("# exported");
      assertValidVcardDocument(batch.text);
    }
  });

  it("splits a multi-card PHOTO fixture into valid vCard bodies", () => {
    const cards = ["Ada", "Bea", "Cy"].map((name) => foldedPhotoCard(name, 800));
    const text = cards.join("\n");
    const maxBytes = Math.max(...cards.map((block) => utf8ByteLength(block))) + 8;
    expect(utf8ByteLength(text)).toBeGreaterThan(maxBytes);

    const plan = planVcardFileBatches(text, maxBytes);
    expect(plan.batches.length).toBeGreaterThan(1);
    let totalCards = 0;
    for (const batch of plan.batches) {
      assertValidVcardDocument(batch.text);
      expect(utf8ByteLength(batch.text)).toBeLessThanOrEqual(maxBytes);
      const begins = batch.text.match(/^BEGIN:VCARD\s*$/gim)?.length ?? 0;
      const ends = batch.text.match(/^END:VCARD\s*$/gim)?.length ?? 0;
      expect(begins).toBe(ends);
      expect(begins).toBe(batch.cardCount);
      expect(batch.text).toContain("PHOTO;ENCODING=b");
      totalCards += begins;
    }
    expect(totalCards).toBe(3);
    expect(plan.oversizedCount).toBe(0);
  });
});

describe("importVcfFilesBatch chunking", () => {
  it("uploads one request for a small file", async () => {
    const importOne = vi.fn().mockResolvedValue({
      list: [{ id: "card-one" }],
      errors: [],
    });
    const text = card("One");
    const result = await importVcfFilesBatch([new File([text], "one.vcf")], importOne, {
      maxBatchBytes: 1024,
    });
    expect(importOne).toHaveBeenCalledTimes(1);
    expect(importOne).toHaveBeenCalledWith(text);
    expect(result.importedFileCount).toBe(1);
  });

  it("uploads sequential batches under the cap for a large multi-card file", async () => {
    const importOne = vi.fn().mockImplementation((vcardText: string) =>
      Promise.resolve({
        list: splitVcardBlocks(vcardText).map((block, index) => ({
          id: `card-${index}-${block.slice(0, 8)}`,
        })),
        errors: [],
      }),
    );
    const one = card("One", 20);
    const two = card("Two", 20);
    const three = card("Three", 20);
    const text = [one, two, three].join("\n");
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two), utf8ByteLength(three)) + 4;

    const progress: Array<{ importedCards: number; batchIndex: number; batchCount: number }> = [];
    const result = await importVcfFilesBatch([new File([text], "big.vcf")], importOne, {
      maxBatchBytes: maxBytes,
      onProgress: (p) => progress.push(p),
    });

    expect(importOne.mock.calls.length).toBeGreaterThan(1);
    for (const [payload] of importOne.mock.calls) {
      expect(utf8ByteLength(payload as string)).toBeLessThanOrEqual(maxBytes);
      assertValidVcardDocument(payload as string);
    }
    expect(result.list).toHaveLength(3);
    expect(progress.at(-1)?.importedCards).toBe(3);
    expect(progress.at(-1)?.batchCount).toBe(importOne.mock.calls.length);
  });

  it("does not start the next batch until the previous POST settles", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const release: Array<() => void> = [];
    const importOne = vi.fn().mockImplementation(
      () =>
        new Promise<{ list: Array<{ id: string }>; errors: [] }>((resolve) => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          release.push(() => {
            inflight -= 1;
            resolve({ list: [{ id: "ok" }], errors: [] });
          });
        }),
    );
    const one = card("One", 20);
    const two = card("Two", 20);
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two)) + 4;

    const done = importVcfFilesBatch([new File([[one, two].join("\n")], "big.vcf")], importOne, {
      maxBatchBytes: maxBytes,
    });

    await vi.waitFor(() => expect(importOne).toHaveBeenCalledTimes(1));
    expect(release).toHaveLength(1);
    release[0]!();
    await vi.waitFor(() => expect(importOne).toHaveBeenCalledTimes(2));
    expect(maxInflight).toBe(1);
    release[1]!();
    await done;
    expect(maxInflight).toBe(1);
  });

  it("continues later batches when a 2xx response has an empty list", async () => {
    const one = card("One", 20);
    const two = card("Two", 20);
    const text = [one, two].join("\n");
    const maxBytes = Math.max(utf8ByteLength(one), utf8ByteLength(two)) + 4;
    const importOne = vi
      .fn()
      .mockResolvedValueOnce({ list: [], errors: [] })
      .mockResolvedValueOnce({ list: [{ id: "card-two" }], errors: [] });

    const result = await importVcfFilesBatch([new File([text], "big.vcf")], importOne, {
      maxBatchBytes: maxBytes,
    });

    expect(importOne).toHaveBeenCalledTimes(2);
    expect(result.list).toHaveLength(1);
    expect(result.fileErrors).toEqual([]);
    expect(result.importedFileCount).toBe(1);
  });

  it("does not POST a single card larger than the cap", async () => {
    const importOne = vi.fn();
    const huge = card("Huge", 80);
    const result = await importVcfFilesBatch([new File([huge], "photo.vcf")], importOne, {
      maxBatchBytes: 40,
    });
    expect(importOne).not.toHaveBeenCalled();
    expect(result.list).toEqual([]);
    expect(result.fileErrors).toEqual([
      { fileName: "photo.vcf", message: VCARD_IMPORT_CARD_TOO_LARGE },
    ]);
  });
});
