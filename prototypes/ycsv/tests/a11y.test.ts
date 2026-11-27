import { describe, expect, it, vi } from "vitest";
import { cellDetails, cellName, headerLabel, presenceSpeech, readableOn, RemoteDigest, selectionSpeech, summarize } from "../src/ycsv-ux/a11y";

describe("spike 8 speech strings", () => {
  it("names headers once, with the ref only when it differs", () => {
    expect(headerLabel({ ref: "prijs", name: "Prijs" })).toBe("Prijs");
    expect(headerLabel({ ref: "k2", name: "Kolom 2" })).toBe("Kolom 2, ref k2");
    expect(headerLabel({ ref: "notes" })).toBe("notes");
  });

  it("speaks errors as words and puts formula + help in the details", () => {
    expect(cellName("#REF!", "#REF")).toBe("reference error");
    expect(cellName("€ 3,27", null)).toBe("€ 3,27");
    expect(cellDetails({ formula: "=aantal*prijs", errorHelp: null, peers: ["Anna", "Ben"] })).toBe("Formula =aantal*prijs. Anna and Ben are also on this cell");
  });

  it("describes ranges by sheet row numbers and column names", () => {
    const h = (c: number) => ["Product", "Aantal", "Prijs"][c]!;
    expect(selectionSpeech([{ r1: 0, c1: 0, r2: 0, c2: 0 }], h)).toBe("");
    expect(selectionSpeech([{ r1: 1, c1: 1, r2: 3, c2: 2 }], h, { sum: 12.5 })).toBe("Aantal row 2 to Prijs row 4 selected, 3 rows by 2 columns, sum 12.5");
    expect(selectionSpeech([{ r1: 4, c1: 0, r2: 4, c2: 2 }], h, { wholeRows: true })).toBe("Row 5 selected");
    expect(selectionSpeech([{ r1: 0, c1: 1, r2: 9, c2: 2 }], h, { wholeCols: true })).toBe("Columns Aantal to Prijs selected, 2 columns");
    expect(selectionSpeech([{ r1: 0, c1: 0, r2: 1, c2: 1 }, { r1: 5, c1: 0, r2: 5, c2: 0 }], h)).toBe("2 ranges selected");
  });

  it("summarizes remote events per person", () => {
    expect(
      summarize([
        { kind: "join", who: "Chris" },
        { kind: "cells", who: "Ben", count: 3 },
        { kind: "rows", who: "Ben", inserted: 2, deleted: 0 },
        { kind: "cells", who: "Ben", count: 1 },
        { kind: "leave", who: "Anna" },
      ]),
    ).toBe("Chris joined. Ben inserted 2 rows and edited 4 cells. Anna left");
    expect(presenceSpeech([])).toBe("Nobody else is in this sheet");
  });

  it("throttles: one line per window, 'my cell' at once but max once a second", () => {
    vi.useFakeTimers();
    const said: string[] = [];
    let t = 0;
    const d = new RemoteDigest((s) => said.push(s), { windowMs: 10_000, now: () => t });
    for (let i = 0; i < 100; i += 1) d.push({ kind: "cells", who: "Ben", count: 1 });
    vi.advanceTimersByTime(500);
    expect(said).toEqual(["Ben edited 100 cells"]);
    t = 2_000;
    d.push({ kind: "cells", who: "Ben", count: 5 });
    vi.advanceTimersByTime(1_000);
    expect(said).toHaveLength(1); // window still closed
    t = 10_500;
    vi.advanceTimersByTime(9_000);
    expect(said[1]).toBe("Ben edited 5 cells");
    d.push({ kind: "here", who: "Ben", place: "this cell", value: "4" });
    d.push({ kind: "here", who: "Ben", place: "this cell", value: "5" });
    expect(said[2]).toBe("Ben changed this cell to 4");
    expect(said).toHaveLength(3); // second within 1 s goes to the digest
    const off = new RemoteDigest((s) => said.push(s), { cellEdits: false });
    off.push({ kind: "cells", who: "Ben", count: 9 });
    vi.advanceTimersByTime(20_000);
    expect(said.some((s) => s.includes("9 cells"))).toBe(false);
    vi.useRealTimers();
  });

  it("picks readable label text on peer colours", () => {
    expect(readableOn("#e8590c")).toBe("#000");
    expect(readableOn("#2b8a3e")).toBe("#000");
    expect(readableOn("#1c3d8f")).toBe("#fff");
  });
});
