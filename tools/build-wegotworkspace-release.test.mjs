import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { writePackagesHtaccess } from "./build-wegotworkspace-release.mjs";

describe("release packages deny file", () => {
  it("writes packages/.htaccess that denies all access", () => {
    const root = mkdtempSync(join(tmpdir(), "wgw-release-deny-"));
    try {
      writePackagesHtaccess(root);
      const body = readFileSync(join(root, "packages", ".htaccess"), "utf8");
      assert.match(body, /Require all denied/);
      assert.match(body, /Deny from all/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
