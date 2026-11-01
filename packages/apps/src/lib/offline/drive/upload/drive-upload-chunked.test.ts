import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSEMBLY_USING,
  BLOB_USING,
  FakeDriveServer,
  fileBytes,
  memoryLocalStorage,
  patternedFile,
} from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";

const fake = vi.hoisted(() => ({ server: null as unknown as FakeDriveServer }));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch: (path: string, init?: RequestInit) => fake.server.fetch(path, init),
}));

import {
  DriveServerFullError,
  DriveUploadInsecureContextError,
  DriveUploadPermanentError,
  DriveUploadTooLargeError,
} from "@/lib/api/wgw/drive-upload-errors";
import {
  appendedAfter,
  sendDriveUploadBytes,
  type DriveUploadProgressUpdate,
} from "@/lib/offline/drive/upload/drive-upload-chunked";
import {
  DRIVE_UPLOAD_PART_SIZE_FLOOR,
  readRememberedPartSize,
} from "@/lib/offline/drive/upload/drive-upload-part-size";
import type { DriveUploadChunkState } from "@/lib/offline/drive/upload/drive-upload-schema";

let server: FakeDriveServer;
let saves: DriveUploadProgressUpdate[];
let controller: AbortController;

function send(file: File, state?: DriveUploadChunkState, username = "ada") {
  return sendDriveUploadBytes({
    session: server.session(),
    username,
    name: file.name,
    mimeType: file.type,
    blob: file,
    signal: controller.signal,
    ...(state ? { state } : {}),
    save: async (update) => {
      saves.push(structuredClone(update));
    },
  });
}

function lastState(): DriveUploadChunkState {
  return saves.at(-1)!.state;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("chunked upload", () => {
  beforeEach(() => {
    server = new FakeDriveServer();
    fake.server = server;
    saves = [];
    controller = new AbortController();
    vi.stubGlobal("localStorage", memoryLocalStorage());
  });

  afterEach(() => {
    controller.abort();
    vi.unstubAllGlobals();
  });

  it("sends a file that fits as one upload with its length and sha256 declared", async () => {
    server.stepBudgetBytes = 10_000;
    const file = patternedFile("small.bin", 900);
    const blobId = await send(file);

    expect(server.uploads).toEqual([
      { length: 900, declaredLength: "900", sha256: sha256(await fileBytes(file)) },
    ]);
    expect(server.calls).toEqual([]);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("sends a large file as parts in order, one at a time, each with length and sha256", async () => {
    const file = patternedFile("big.bin", 2_500);
    const blobId = await send(file);
    const bytes = await fileBytes(file);

    // maxSizeUpload is 1 000, the step budget 600: parts start at 600.
    expect(server.uploads.map((upload) => upload.length)).toEqual([600, 600, 600, 600, 100]);
    expect(server.maxActiveUploads).toBe(1);
    let offset = 0;
    for (const upload of server.uploads) {
      expect(upload.declaredLength).toBe(String(upload.length));
      expect(upload.sha256).toBe(sha256(bytes.slice(offset, offset + upload.length)));
      offset += upload.length;
    }
    expect(server.bytesOf(blobId)).toEqual(bytes);
    // Progress per part.
    expect(saves.filter((save) => !save.phase).map((save) => save.bytesDone)).toEqual([
      0, 600, 1_200, 1_800, 2_400, 2_500,
    ]);
  });

  it("caps the starting part size by the assembly step budget, so a part fits in one step", async () => {
    server.maxSizeUpload = 10_000;
    server.stepBudgetBytes = 700;
    await send(patternedFile("big.bin", 2_000));

    expect(server.uploads.map((upload) => upload.length)).toEqual([700, 700, 600]);
    for (const append of server.callsNamed("BlobAssembly/append")) {
      expect((append.args.parts as unknown[]).length).toBe(1);
    }
  });

  it("assembles with the extension in `using`, in steps within the budget", async () => {
    server.maxSizeUpload = 300;
    server.stepBudgetBytes = 650;
    const file = patternedFile("big.bin", 1_500);
    const blobId = await send(file);

    expect(server.callsNamed("BlobAssembly/set")).toHaveLength(1);
    const appends = server.callsNamed("BlobAssembly/append");
    expect(
      appends.map((call) => (call.args.parts as Array<{ index: number }>).map((p) => p.index)),
    ).toEqual([[0, 1], [2, 3], [4]]);
    for (const call of server.calls) expect(call.using).toEqual(ASSEMBLY_USING);
    expect(server.callsNamed("Blob/upload")).toEqual([]);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("exposes an assembling phase with its own progress", async () => {
    server.maxSizeUpload = 300;
    server.stepBudgetBytes = 650;
    await send(patternedFile("big.bin", 1_500));

    const assembling = saves.filter((save) => save.phase === "assembling");
    expect(assembling.map((save) => save.assembledBytes)).toEqual([0, 600, 1_200, 1_500, 1_500]);
    expect(assembling.every((save) => save.bytesDone === 1_500)).toBe(true);
  });

  it("joins with one plain Blob/upload within maxDataSources when the extension is absent", async () => {
    server.assemblyExtension = false;
    server.maxSizeUpload = 400;
    const file = patternedFile("big.bin", 1_000);
    const blobId = await send(file);

    expect(server.uploads.map((upload) => upload.length)).toEqual([400, 400, 200]);
    const joins = server.callsNamed("Blob/upload");
    expect(joins).toHaveLength(1);
    expect(joins[0]!.using).toEqual(BLOB_USING);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("fails the plain Blob/upload fallback as permanent instead of splitting it (maxDataSources)", async () => {
    server.assemblyExtension = false;
    server.maxSizeUpload = 400;
    server.maxDataSources = 2;

    await expect(send(patternedFile("big.bin", 1_000))).rejects.toBeInstanceOf(
      DriveUploadPermanentError,
    );
    expect(server.uploads).toEqual([]);
    expect(server.callsNamed("Blob/upload")).toEqual([]);
  });

  it("fails the plain Blob/upload fallback as permanent when the call is too large, without splitting", async () => {
    server.assemblyExtension = false;
    server.maxSizeUpload = 400;
    server.blobUploadTooLarge = true;

    await expect(send(patternedFile("big.bin", 1_000))).rejects.toBeInstanceOf(
      DriveUploadPermanentError,
    );
    expect(server.callsNamed("Blob/upload")).toHaveLength(1);
  });

  it("halves the part size on a 413 and retries that part, and remembers it for the account", async () => {
    const floor = DRIVE_UPLOAD_PART_SIZE_FLOOR;
    server.maxSizeUpload = 4 * floor;
    server.stepBudgetBytes = 100 * floor;
    server.hostLimit = floor + 1;
    const file = patternedFile("big.bin", 4 * floor);
    const blobId = await send(file);

    const lengths = server.uploads.map((upload) => upload.length);
    // 4× refused, 2× refused, 1× fits: the rest goes at the floor size.
    expect(lengths).toEqual([4 * floor, 2 * floor, floor, floor, floor, floor]);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
    expect(lastState().partSize).toBe(floor);
    expect(readRememberedPartSize("ada")).toBe(floor);

    server.uploads.length = 0;
    await send(patternedFile("next.bin", 2 * floor));
    expect(server.uploads.map((upload) => upload.length)).toEqual([floor, floor]);
  });

  it("halves the part size on a `limit` problem, down to the floor, then fails as too_large", async () => {
    server.maxSizeUpload = 4 * DRIVE_UPLOAD_PART_SIZE_FLOOR;
    server.stepBudgetBytes = 100 * DRIVE_UPLOAD_PART_SIZE_FLOOR;
    server.limitProblemAbove = DRIVE_UPLOAD_PART_SIZE_FLOOR - 1;

    await expect(
      send(patternedFile("big.bin", 4 * DRIVE_UPLOAD_PART_SIZE_FLOOR)),
    ).rejects.toBeInstanceOf(DriveUploadTooLargeError);
    expect(server.uploads.map((upload) => upload.length)).toEqual([
      4 * DRIVE_UPLOAD_PART_SIZE_FLOOR,
      2 * DRIVE_UPLOAD_PART_SIZE_FLOOR,
      DRIVE_UPLOAD_PART_SIZE_FLOOR,
    ]);
  });

  it("treats a part the server stored short (a discarded body) as too large, never as a success", async () => {
    const floor = DRIVE_UPLOAD_PART_SIZE_FLOOR;
    server.maxSizeUpload = 4 * floor;
    server.stepBudgetBytes = 100 * floor;
    server.discardAbove = 2 * floor - 1;
    const file = patternedFile("big.bin", 4 * floor);
    const blobId = await send(file);

    expect(server.uploads.map((upload) => upload.length)).toEqual([
      4 * floor,
      2 * floor,
      floor,
      floor,
      floor,
      floor,
    ]);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("sends smaller steps, not smaller parts, after a `limit` on an assembly step", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 1_000;
    server.maxPartsPerStep = 2;
    const file = patternedFile("big.bin", 1_000);
    const blobId = await send(file);

    expect(server.uploads.every((upload) => upload.length === 200)).toBe(true);
    const sizes = server
      .callsNamed("BlobAssembly/append")
      .map((call) => (call.args.parts as unknown[]).length);
    expect(sizes).toEqual([5, 2, 2, 1]);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("fails as permanent when even one part per step is refused", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 1_000;
    server.maxPartsPerStep = 0;

    await expect(send(patternedFile("big.bin", 600))).rejects.toBeInstanceOf(
      DriveUploadPermanentError,
    );
    expect(server.uploads.every((upload) => upload.length === 200)).toBe(true);
  });

  it("re-sends the same remaining parts after a hash-rebuild-only answer, never an accepted one", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 400;
    server.rebuildOnlyAppends = 1;
    const file = patternedFile("big.bin", 800);
    const blobId = await send(file);

    const steps = server
      .callsNamed("BlobAssembly/append")
      .map((call) => (call.args.parts as Array<{ index: number }>).map((p) => p.index));
    expect(steps).toEqual([
      [0, 1],
      [0, 1],
      [2, 3],
    ]);
    // Not glued twice: the result is exactly the file.
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("never sends a part again once the server lists it as accepted", () => {
    expect(appendedAfter(2, { accepted: [2, 3], nextIndex: 4 })).toBe(4);
    expect(appendedAfter(2, { accepted: [], nextIndex: 2 })).toBe(2);
    expect(appendedAfter(2, { accepted: [0, 1, 2], nextIndex: 3 })).toBe(3);
  });

  it("stops on a 507 for a part without retrying", async () => {
    server.full = true;
    await expect(send(patternedFile("big.bin", 2_000))).rejects.toBeInstanceOf(
      DriveServerFullError,
    );
    expect(server.uploads).toHaveLength(1);
  });

  it("stops on a 507 for an assembly step without retrying", async () => {
    server.maxSizeUpload = 300;
    const file = patternedFile("big.bin", 900);
    const sending = send(file);
    // Fill the disk once every part is on the server.
    const originalCall = server.call.bind(server);
    vi.spyOn(server, "call").mockImplementation(async (name, args, options) => {
      if (name === "BlobAssembly/append") server.full = true;
      return originalCall(name, args, options);
    });
    await expect(sending).rejects.toBeInstanceOf(DriveServerFullError);
    expect(server.callsNamed("BlobAssembly/append")).toHaveLength(1);
  });

  describe("without crypto.subtle (an http:// install)", () => {
    beforeEach(() => {
      vi.stubGlobal("crypto", { randomUUID: () => "x" });
    });

    it("fails a file larger than maxSizeUpload with insecure_context before any part is sent", async () => {
      await expect(send(patternedFile("big.bin", 1_500))).rejects.toBeInstanceOf(
        DriveUploadInsecureContextError,
      );
      expect(server.uploads).toEqual([]);
      expect(server.calls).toEqual([]);
    });

    it("sends a file between the step budget and maxSizeUpload whole, not as parts", async () => {
      server.maxSizeUpload = 2_000;
      server.stepBudgetBytes = 600;
      const blobId = await send(patternedFile("mid.bin", 1_500));
      expect(server.uploads).toEqual([{ length: 1_500, declaredLength: "1500" }]);
      expect(blobId).toMatch(/^jb-/);
    });

    it("still uploads a small file, with its length declared", async () => {
      const blobId = await send(patternedFile("small.bin", 500));
      expect(server.uploads).toEqual([{ length: 500, declaredLength: "500" }]);
      expect(blobId).toMatch(/^jb-/);
    });
  });

  it("resumes from the next part after a reload", async () => {
    server.maxSizeUpload = 200;
    const file = patternedFile("big.bin", 1_000);
    const original = server.fetch.bind(server);
    let uploads = 0;
    vi.spyOn(server, "fetch").mockImplementation(async (path, init) => {
      uploads += 1;
      if (uploads === 3) throw new TypeError("Failed to fetch");
      return original(path, init);
    });
    await expect(send(file)).rejects.toThrow("Failed to fetch");
    const stored = lastState();
    expect(stored.parts).toHaveLength(2);

    vi.mocked(server.fetch).mockRestore();
    server.uploads.length = 0;
    const blobId = await send(file, stored);

    expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200]);
    expect(server.callsNamed("BlobAssembly/set")).toHaveLength(1);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("retries a timed-out assembly step from the last finished step the server reports", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 400;
    server.appendLostResponses = 1;
    const file = patternedFile("big.bin", 1_000);
    await expect(send(file)).rejects.toThrow("Failed to fetch");
    // The server applied step 1 (parts 0 and 1) but the answer never arrived.
    const stored = lastState();
    expect(stored.appendedParts).toBe(0);

    const blobId = await send(file, stored);
    const steps = server
      .callsNamed("BlobAssembly/append")
      .map((call) => (call.args.parts as Array<{ index: number }>).map((p) => p.index));
    expect(steps).toEqual([[0, 1], [2, 3], [4]]);
    expect(server.callsNamed("BlobAssembly/get").length).toBeGreaterThan(0);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("re-uploads only the parts Blob/upload reports missing", async () => {
    server.assemblyExtension = false;
    server.maxSizeUpload = 200;
    const file = patternedFile("big.bin", 600);
    const original = server.call.bind(server);
    let expired = false;
    vi.spyOn(server, "call").mockImplementation(async (name, args, options) => {
      if (name === "Blob/upload" && !expired) {
        expired = true;
        server.expire([lastState().parts[1]!.blobId]);
      }
      return original(name, args, options);
    });
    const blobId = await send(file);

    expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200, 200]);
    expect(server.callsNamed("Blob/upload")).toHaveLength(2);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("re-uploads only the parts an assembly step reports missing", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 1_000;
    const file = patternedFile("big.bin", 600);
    const original = server.call.bind(server);
    let expired = false;
    vi.spyOn(server, "call").mockImplementation(async (name, args, options) => {
      if (name === "BlobAssembly/append" && !expired) {
        expired = true;
        server.expire([lastState().parts[2]!.blobId]);
      }
      return original(name, args, options);
    });
    const blobId = await send(file);

    expect(server.uploads).toHaveLength(4);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });

  it("opens a new assembly when the stored one expired, and re-sends the parts it lost", async () => {
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 400;
    server.appendLostResponses = 1;
    const file = patternedFile("big.bin", 600);
    await expect(send(file)).rejects.toThrow("Failed to fetch");
    const stored = lastState();
    server.assemblies.clear();

    const blobId = await send(file, stored);
    expect(server.callsNamed("BlobAssembly/set")).toHaveLength(2);
    // Parts 0 and 1 were consumed by the lost assembly: only they go again.
    expect(server.uploads).toHaveLength(5);
    expect(sha256(server.bytesOf(blobId)!)).toBe(sha256(await fileBytes(file)));
  });
});
