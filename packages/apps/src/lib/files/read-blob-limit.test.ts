import { describe, expect, it, vi } from "vitest";
import { DriveFileTooLargeToOpenError, readResponseBlobWithin } from "@/lib/files/read-blob-limit";

/** A body that hands out `chunks` one read at a time and records a cancel. */
function chunkedBody(chunks: Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn();
  const pulled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled();
      const next = chunks[index++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel,
  });
  return { body, cancel, pulled };
}

describe("readResponseBlobWithin", () => {
  it("refuses a Content-Length above the limit without reading the body", async () => {
    const { body, cancel, pulled } = chunkedBody([new Uint8Array(4)]);
    const res = new Response(body, { headers: { "Content-Length": "11" } });

    const read = readResponseBlobWithin(res, 10, "big.mp4");

    await expect(read).rejects.toBeInstanceOf(DriveFileTooLargeToOpenError);
    await expect(read).rejects.toMatchObject({ fileName: "big.mp4", size: 11 });
    expect(cancel).toHaveBeenCalled();
    expect(pulled.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("stops reading once the bytes received pass the limit", async () => {
    const { body, cancel, pulled } = chunkedBody([
      new Uint8Array(6),
      new Uint8Array(6),
      new Uint8Array(6),
      new Uint8Array(6),
    ]);
    const res = new Response(body);

    await expect(readResponseBlobWithin(res, 10, "big.mp4")).rejects.toMatchObject({
      name: "DriveFileTooLargeToOpenError",
      size: 12,
    });
    expect(cancel).toHaveBeenCalled();
    expect(pulled.mock.calls.length).toBeLessThan(4);
  });

  it("returns the bytes with the response content type below the limit", async () => {
    const res = new Response("hello", {
      headers: { "Content-Type": "image/png", "Content-Length": "5" },
    });

    const blob = await readResponseBlobWithin(res, 10, "small.png");

    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("hello");
  });

  it("returns a file exactly at the limit", async () => {
    const res = new Response(new Uint8Array(10));

    const blob = await readResponseBlobWithin(res, 10, "edge.bin");

    expect(blob.size).toBe(10);
  });
});
