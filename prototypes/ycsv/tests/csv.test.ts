import { expect, test } from "vitest";
import { parseCsv, serializeCsv } from "../src/ycsv-core/csv";

test("parses and serializes RFC 4180 csv", () => {
  expect(parseCsv("a,b\n1,2\n")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
  expect(parseCsv('a,"b,c"\n')).toEqual([["a", "b,c"]]);
  expect(parseCsv('a,"b""c"\n')).toEqual([["a", 'b"c']]);
  expect(parseCsv('a,"b\nc"\n')).toEqual([["a", "b\nc"]]);
  expect(
    serializeCsv([
      ["a", "b,c"],
      ["d", 'e"f'],
    ]),
  ).toBe('a,"b,c"\nd,"e""f"\n');
  expect(serializeCsv([["a", " b "]])).toBe("a, b \n");
});
