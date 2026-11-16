import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  ERROR_DIAGNOSTICS_LIMIT,
  appendErrorDiagnostic,
  readErrorDiagnostics,
  type NewErrorDiagnostic,
} from "@/lib/diagnostics/error-diagnostics-store";

function entry(message: string, overrides: Partial<NewErrorDiagnostic> = {}): NewErrorDiagnostic {
  return {
    time: "2026-11-16T10:00:00.000Z",
    source: "error",
    name: "TypeError",
    message,
    stack: `TypeError: ${message}\n    at run (/assets/index.js:1:2)`,
    app: "drive",
    route: "/drive",
    build: "0.1.124",
    userAgent: "test-agent",
    ...overrides,
  };
}

describe("error diagnostics ring buffer", () => {
  it("keeps the newest entries up to the cap and drops the oldest first", async () => {
    const idb = new IDBFactory();
    const total = ERROR_DIAGNOSTICS_LIMIT + 5;
    for (let index = 0; index < total; index += 1) {
      await appendErrorDiagnostic(entry(`failure ${index}`), idb);
    }

    const rows = await readErrorDiagnostics(idb);

    expect(ERROR_DIAGNOSTICS_LIMIT).toBe(50);
    expect(rows).toHaveLength(ERROR_DIAGNOSTICS_LIMIT);
    expect(rows[0]?.message).toBe(`failure ${total - 1}`);
    expect(rows.at(-1)?.message).toBe("failure 5");
    expect(rows.some((row) => row.message === "failure 4")).toBe(false);
  });

  it("counts a repeat of the newest error instead of filling the buffer with copies", async () => {
    const idb = new IDBFactory();
    await appendErrorDiagnostic(entry("first"), idb);
    await appendErrorDiagnostic(entry("loop"), idb);
    await appendErrorDiagnostic(entry("loop", { time: "2026-11-16T10:00:05.000Z" }), idb);
    await appendErrorDiagnostic(entry("loop", { time: "2026-11-16T10:00:09.000Z" }), idb);

    const rows = await readErrorDiagnostics(idb);

    expect(rows.map((row) => [row.message, row.count])).toEqual([
      ["loop", 3],
      ["first", 1],
    ]);
    expect(rows[0]?.time).toBe("2026-11-16T10:00:09.000Z");
  });

  it("reads an empty list on a device with nothing recorded", async () => {
    expect(await readErrorDiagnostics(new IDBFactory())).toEqual([]);
  });
});
