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
  utf8ByteLength,
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
});

function card(name: string, pad = 0): string {
  const note = pad > 0 ? `\nNOTE:${"x".repeat(pad)}` : "";
  return `BEGIN:VCARD\nFN:${name}${note}\nEND:VCARD`;
}

describe("planVcardFileBatches", () => {
  it("keeps a small file as one original-text payload", () => {
    const text = card("One");
    const plan = planVcardFileBatches(text, 1024);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.text).toBe(text);
    expect(plan.batches[0]?.cardCount).toBe(1);
    expect(plan.oversizedCount).toBe(0);
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

  it("flags a single card larger than the cap", () => {
    const huge = card("Huge", 80);
    const packed = packVcardBlocks([huge], 40);
    expect(packed.batches).toEqual([]);
    expect(packed.oversizedCount).toBe(1);
    expect(utf8ByteLength(huge)).toBeGreaterThan(40);
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
    }
    expect(result.list).toHaveLength(3);
    expect(progress.at(-1)?.importedCards).toBe(3);
    expect(progress.at(-1)?.batchCount).toBe(importOne.mock.calls.length);
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
