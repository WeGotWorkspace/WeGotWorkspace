// Large-file parse timings for both implementations (spike 11). Writes large-results.json.
// Not a benchmark harness: one warm-up, median of 3, single machine, other sessions running.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { coreImpl } from "../adapters/core";
import { protoImpl } from "../adapters/proto";
import type { Impl } from "../adapters/types";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function bigSheet(rows: number, cols: number, formulas: boolean): string {
  const refs = Array.from({ length: cols }, (_, i) => `c${String.fromCharCode(97 + (i % 26))}${i}`);
  const lines = [refs.join(",")];
  for (let r = 1; r <= rows; r++) {
    const cells = refs.map((ref, c) => {
      if (formulas && c === cols - 1) return `=${refs[0]}${r}*2`;
      if (c % 3 === 0) return String((r * 7 + c) % 1000);
      if (c % 3 === 1) return `"text ${r}, ${c}"`;
      return `2024-01-${String((r % 28) + 1).padStart(2, "0")}`;
    });
    lines.push(cells.join(","));
  }
  return `---\nycsv_version: 1\n---\n${lines.join("\n")}\n`;
}

function multiSheet(sheets: number, rows: number): string {
  const fm = ["ycsv_version: 1", "sheets:", ...Array.from({ length: sheets }, (_, i) => `  - ref: s${i}`)].join("\n");
  const bodies = Array.from({ length: sheets }, (_, i) =>
    ["a,b", ...Array.from({ length: rows }, (_, r) => `${r},=${i > 0 ? `s${i - 1}!` : ""}a${r + 1}+1`)].join("\n"),
  );
  return `---\n${fm}\n---\n${bodies.join("\n---\n")}\n`;
}

function time(impl: Impl, text: string): { ms: number; status: string } {
  impl.parse(text); // warm-up
  const runs: number[] = [];
  let status = "";
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = impl.parse(text);
    runs.push(performance.now() - t0);
    status = r.status === "ok" ? `ok, ${r.sheets.reduce((n, s) => n + s.rows.length, 0)} rows` : `error: ${r.error.slice(0, 60)}`;
  }
  runs.sort((a, b) => a - b);
  return { ms: Math.round(runs[1]!), status };
}

test("large files", () => {
  const inputs: Record<string, string> = {
    "10k x 10, no formulas": bigSheet(10_000, 10, false),
    "10k x 10, 1 formula column": bigSheet(10_000, 10, true),
    "100k x 10, 1 formula column": bigSheet(100_000, 10, true),
    "1 cell of 5 MB": `---\nycsv_version: 1\n---\na\n"${"x".repeat(5 * 1024 * 1024)}"\n`,
    "50 sheets x 200 rows, chained cross-sheet refs": multiSheet(50, 200),
  };
  const results: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(inputs)) {
    results[name] = {
      bytes: Buffer.byteLength(text),
      core: time(coreImpl, text),
      proto: time(protoImpl, text),
    };
  }
  writeFileSync(here("./large-results.json"), `${JSON.stringify({ node: process.version, results }, null, 2)}\n`);
  expect(Object.keys(results).length).toBe(5);
}, 600_000);
