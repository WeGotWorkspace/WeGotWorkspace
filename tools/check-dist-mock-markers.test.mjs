import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  MOCK_MARKERS,
  findMarkersInDist,
  staleMarkers,
} from "./check-dist-mock-markers.mjs";

function withDist(files, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-dist-"));
  try {
    mkdirSync(path.join(dir, "assets"));
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(dir, "assets", name), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const markers = [
  { marker: "Alan Turing", source: "lib/api/mock/meet-chat-fixtures.ts" },
];

test("findMarkersInDist reports a marker in a JS asset", () => {
  withDist(
    { "meet-app-abc.js": 'const p={name:"Alan Turing"};', "index-1.js": "x" },
    (dir) => {
      assert.deepEqual(findMarkersInDist(dir, markers), [
        { ...markers[0], file: "assets/meet-app-abc.js" },
      ]);
    },
  );
});

test("findMarkersInDist ignores non-JS assets and clean bundles", () => {
  withDist({ "index-1.js": "x", "notes.css": "/* Alan Turing */" }, (dir) => {
    assert.deepEqual(findMarkersInDist(dir, markers), []);
  });
});

test("findMarkersInDist throws without a build", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wgw-dist-"));
  try {
    assert.throws(
      () => findMarkersInDist(dir, markers),
      /Run `pnpm --filter @wgw\/apps run build`/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every marker is still written by its mock module", () => {
  assert.deepEqual(staleMarkers(MOCK_MARKERS), []);
});

test("staleMarkers flags a marker its module no longer contains", () => {
  const stale = [
    { marker: "Nobody Here", source: "lib/api/mock/meet-chat-fixtures.ts" },
  ];
  assert.deepEqual(staleMarkers(stale), stale);
});
