import { describe, expect, it } from "vitest";
import { decodeFramedPayload, encodeFramedPayload } from "./framed-payload";

const encoder = new TextEncoder();

function headerOf(bytes: Uint8Array): { documentLen: number | null; yjsLen: number | null } {
  const framed = decodeFramedPayload(bytes);
  expect(framed).not.toBeNull();
  return framed!.header as { documentLen: number | null; yjsLen: number | null };
}

describe("framed payload", () => {
  it("locks the same header bytes the PHP encoder writes", () => {
    const header = encoder.encode('{"documentLen":4,"yjsLen":4}');
    const expected = new Uint8Array(2 + header.byteLength + 8);
    expected[1] = header.byteLength;
    expected.set(header, 2);
    expected.set(encoder.encode("abcdefgh"), 2 + header.byteLength);

    expect(
      encodeFramedPayload({ documentLen: 4, yjsLen: 4 }, [
        encoder.encode("abcd"),
        encoder.encode("efgh"),
      ]),
    ).toEqual(expected);
  });

  it("marks a missing part with null and an empty part with zero", () => {
    const markdown = encoder.encode("# only\n");
    const markdownOnly = encodeFramedPayload({ documentLen: markdown.byteLength, yjsLen: null }, [
      markdown,
    ]);
    expect(headerOf(markdownOnly)).toEqual({ documentLen: markdown.byteLength, yjsLen: null });
    expect(decodeFramedPayload(markdownOnly)?.tail).toEqual(markdown);

    const yjs = encoder.encode("y");
    const yjsOnly = encodeFramedPayload({ documentLen: null, yjsLen: yjs.byteLength }, [yjs]);
    expect(headerOf(yjsOnly)).toEqual({ documentLen: null, yjsLen: 1 });

    const emptyYjs = encodeFramedPayload({ documentLen: markdown.byteLength, yjsLen: 0 }, [
      markdown,
      new Uint8Array(),
    ]);
    expect(headerOf(emptyYjs).yjsLen).toBe(0);
    expect(decodeFramedPayload(emptyYjs)?.tail).toEqual(markdown);
  });

  it("keeps every byte value, invalid UTF-8, and CSV quotes in the tail", () => {
    const every = new Uint8Array(256);
    for (let byte = 0; byte < 256; byte += 1) every[byte] = byte;
    const invalidUtf8 = Uint8Array.from([0x80, 0xbf, 0xff, 0xc3, 0x28]);
    const csv = encoder.encode('"a","b"\n"c","d"\n');
    const framed = encodeFramedPayload(
      { documentLen: invalidUtf8.byteLength + csv.byteLength, yjsLen: every.byteLength },
      [invalidUtf8, csv, every],
    );
    const decoded = decodeFramedPayload(framed);
    expect(decoded?.tail.subarray(0, invalidUtf8.byteLength)).toEqual(invalidUtf8);
    expect(
      decoded?.tail.subarray(invalidUtf8.byteLength, invalidUtf8.byteLength + csv.byteLength),
    ).toEqual(csv);
    expect(decoded?.tail.subarray(invalidUtf8.byteLength + csv.byteLength)).toEqual(every);
  });

  it("returns null for a short buffer, a header past the body, bad JSON, and a non-object", () => {
    expect(decodeFramedPayload(new Uint8Array([0]))).toBeNull();
    expect(decodeFramedPayload(Uint8Array.from([0, 40, ...encoder.encode("short")]))).toBeNull();
    const notJson = encoder.encode("not-json");
    const bad = new Uint8Array(2 + notJson.byteLength);
    bad[1] = notJson.byteLength;
    bad.set(notJson, 2);
    expect(decodeFramedPayload(bad)).toBeNull();
    const list = encoder.encode("[1,2]");
    const arrayHeader = new Uint8Array(2 + list.byteLength);
    arrayHeader[1] = list.byteLength;
    arrayHeader.set(list, 2);
    expect(decodeFramedPayload(arrayHeader)).toBeNull();
  });
});
