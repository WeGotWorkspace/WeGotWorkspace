import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";

import {
  CORE_ALLOWLIST,
  importBoundariesRule,
  layerOf,
  targetModule,
  violation,
} from "./eslint-import-boundaries.mjs";
import { collectEdges, compareToBaseline, lowerBaseline, summarize } from "./lint-boundaries.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const cwd = "/repo/packages/apps";
const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: "module" },
});

/** @param {string} file @param {string} code */
const at = (file, code, options = {}) => ({
  code,
  filename: `${cwd}/src/${file}`,
  options: [{ srcRoot: `${cwd}/src`, ...options }],
});

describe("layerOf", () => {
  it("puts lib, types and assets at the base, wegotworkspace at the top", () => {
    expect(layerOf("lib")).toBe("base");
    expect(layerOf("types")).toBe("base");
    expect(layerOf("assets")).toBe("base");
    expect(layerOf("wegotworkspace")).toBe("shell");
  });

  it("treats *-core as an app package and every other folder as a primitive", () => {
    expect(layerOf("drive-core")).toBe("core");
    expect(layerOf("share-ui")).toBe("primitive");
    expect(layerOf("workspace-shell")).toBe("primitive");
    expect(layerOf("hooks")).toBe("primitive");
  });
});

describe("targetModule", () => {
  it("resolves alias and relative specifiers to the top-level src folder", () => {
    expect(targetModule("@/drive-core/src/drive-types", "lib/files/a.ts")).toBe("drive-core");
    expect(targetModule("@/ui", "lib/a.ts")).toBe("ui");
    expect(targetModule("../../drive-core/src/x", "lib/files/a.ts")).toBe("drive-core");
    expect(targetModule("./b", "lib/files/a.ts")).toBe("lib");
  });

  it("ignores npm packages, root files and paths outside src", () => {
    expect(targetModule("react", "lib/a.ts")).toBeNull();
    expect(targetModule("../styles.css", "lib/a.ts")).toBeNull();
    expect(targetModule("../../package.json", "lib/a.ts")).toBeNull();
  });
});

describe("violation", () => {
  it("reports any import into a higher layer", () => {
    expect(violation("lib", "drive-core")).toBe("upward");
    expect(violation("lib", "share-ui")).toBe("upward");
    expect(violation("share-ui", "drive-core")).toBe("upward");
    expect(violation("drive-core", "wegotworkspace")).toBe("upward");
  });

  it("allows imports into the same or a lower layer", () => {
    expect(violation("drive-core", "lib")).toBeNull();
    expect(violation("drive-core", "share-ui")).toBeNull();
    expect(violation("share-ui", "ui")).toBeNull();
    expect(violation("wegotworkspace", "drive-core")).toBeNull();
  });

  it("reports app package to app package unless the pair is allowlisted", () => {
    expect(violation("drive-core", "docs-core")).toBe("crossCore");
    expect(violation("docs-core", "drive-core")).toBeNull();
    expect(violation("text-editor-core", "docs-core")).toBe("crossCore");
  });

  it("gives every allowlist entry a reason and a real direction", () => {
    for (const entry of CORE_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(layerOf(entry.from)).toBe("core");
      expect(layerOf(entry.to)).toBe("core");
      expect(entry.from).not.toBe(entry.to);
    }
  });
});

ruleTester.run("import-boundaries", importBoundariesRule, {
  valid: [
    at("drive-core/src/a.ts", 'import { x } from "@/lib/files/api-path";'),
    at("drive-core/src/a.ts", 'import { x } from "../../share-ui/src/b";'),
    at("lib/files/a.ts", 'import { x } from "./b";'),
    at("docs-core/src/a.ts", 'import type { X } from "@/drive-core/src/drive-types";'),
    at("wegotworkspace/src/a.tsx", 'import { DriveApp } from "@/drive-core/src/drive-app";'),
    at("main.tsx", 'import "@/wegotworkspace/src/wegotworkspace";'),
    at("lib/a.ts", 'import React from "react";'),
  ],
  invalid: [
    {
      ...at("lib/offline/a.ts", 'import type { DriveItem } from "@/drive-core/src/drive-types";'),
      errors: [
        {
          messageId: "upward",
          data: { from: "lib", fromLayer: "base", to: "drive-core", toLayer: "core" },
        },
      ],
    },
    {
      ...at("lib/offline/a.ts", 'export { x } from "../../share-ui/src/b";'),
      errors: [{ messageId: "upward" }],
    },
    {
      ...at("share-ui/src/a.ts", 'export * from "@/drive-core/src/drive-path-utils";'),
      errors: [{ messageId: "upward" }],
    },
    {
      ...at("drive-core/src/a.ts", 'const m = import("@/docs-core/src/use-open-docs-file");'),
      errors: [{ messageId: "crossCore" }],
    },
    {
      ...at("drive-core/src/a.ts", 'import "@/wegotworkspace/src/wegotworkspace-routes";'),
      errors: [{ messageId: "upward" }],
    },
    {
      ...at("docs-core/src/a.ts", 'import { x } from "@/lib/x";', { reportAll: true }),
      errors: [
        {
          messageId: "edge",
          data: { from: "docs-core", fromLayer: "core", to: "lib", toLayer: "base" },
        },
      ],
    },
  ],
});

describe("lint-boundaries summary", () => {
  const edge = (from, fromLayer, to, toLayer) => ({
    ruleId: "wgw-boundaries/import-boundaries",
    message: `Import edge: ${from} (${fromLayer}) -> ${to} (${toLayer}).`,
  });
  const results = [
    {
      filePath: "/x/src/docs-core/src/a.ts",
      messages: [
        edge("docs-core", "core", "drive-core", "core"),
        edge("docs-core", "core", "lib", "base"),
      ],
    },
    {
      filePath: "/x/src/drive-core/src/b.ts",
      messages: [
        edge("drive-core", "core", "docs-core", "core"),
        edge("drive-core", "core", "docs-core", "core"),
      ],
    },
    { filePath: "/x/src/lib/c.ts", messages: [edge("lib", "base", "drive-core", "core")] },
  ];

  it("counts only violating edges, by file and by import line", () => {
    const summary = summarize(collectEdges(results));
    expect(summary.warnings).toBe(3);
    expect(summary.files).toBe(2);
    expect(summary.edges.map((e) => [e.from, e.to, e.kind, e.files, e.lines])).toEqual([
      ["drive-core", "docs-core", "crossCore", 1, 2],
      ["lib", "drive-core", "upward", 1, 1],
    ]);
  });

  it("counts each importing file once per layer pair", () => {
    const twoTargets = [
      {
        filePath: "/x/src/lib/d.ts",
        messages: [
          edge("lib", "base", "drive-core", "core"),
          edge("lib", "base", "docs-core", "core"),
        ],
      },
      ...results,
    ];
    const summary = summarize(collectEdges(twoTargets));
    expect(summary.layerPairs).toEqual([
      { layers: "base -> core", files: 2 },
      { layers: "core -> core", files: 1 },
    ]);
  });

  it("counts a cycle once, including an allowlisted direction, and leaves lib out", () => {
    const summary = summarize(collectEdges(results));
    expect(summary.twoWayPairs).toEqual([{ a: "docs-core", b: "drive-core", aToB: 1, bToA: 1 }]);
  });

  it("fails loudly on a message it cannot parse", () => {
    const bad = [
      {
        filePath: "/x/src/a/b.ts",
        messages: [{ ruleId: "wgw-boundaries/import-boundaries", message: "?" }],
      },
    ];
    expect(() => collectEdges(bad)).toThrow(/Unexpected message/);
  });
});

describe("lint-boundaries baseline", () => {
  /** @param {[string, string, number][]} rows */
  const summaryOf = (rows) => ({
    edges: rows.map(([from, to, files]) => ({ from, to, files })),
  });

  it("fails on a new edge and on an edge with more files", () => {
    const { failures } = compareToBaseline(
      summaryOf([
        ["lib", "drive-core", 3],
        ["lib", "docs-core", 1],
      ]),
      { "lib -> drive-core": 2 },
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/lib -> drive-core grew from 2 to 3 files/);
    expect(failures[1]).toMatch(/new edge lib -> docs-core \(1 files\)/);
  });

  it("only notices an edge that shrank or is gone", () => {
    const { failures, notices } = compareToBaseline(summaryOf([["lib", "drive-core", 1]]), {
      "lib -> drive-core": 2,
      "lib -> docs-core": 4,
    });
    expect(failures).toEqual([]);
    expect(notices).toEqual([
      "lib -> drive-core dropped from 2 to 1 files",
      "lib -> docs-core is gone",
    ]);
  });

  it("lowers counts and drops gone edges, but never raises or adds", () => {
    const next = lowerBaseline(
      summaryOf([
        ["lib", "drive-core", 1],
        ["lib", "meet-core", 9],
        ["lib", "notes-core", 5],
      ]),
      { "lib -> drive-core": 2, "lib -> docs-core": 4, "lib -> meet-core": 3 },
    );
    expect(next).toEqual({ "lib -> drive-core": 1, "lib -> meet-core": 3 });
  });
});
