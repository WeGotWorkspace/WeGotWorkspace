import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  releaseNotesUrl,
  releasePackageUrl,
  writePackagesHtaccess,
} from "./build-wegotworkspace-release.mjs";

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

describe("release manifest URLs", () => {
  it("leaves package and notes URLs empty without a release tag", () => {
    assert.equal(releasePackageUrl("wegotworkspace-deploy-1.0.0.zip", {}), "");
    assert.equal(releaseNotesUrl({}), "");
  });

  it("points the package at the hosting release, not the channel feed", () => {
    const env = { WGW_RELEASE_TAG: "v1.0.0-beta.1" };
    assert.equal(
      releasePackageUrl("wegotworkspace-deploy-1.0.0-beta.1.zip", env),
      "https://github.com/WeGotWorkspace/wegotworkspace/releases/download/v1.0.0-beta.1/wegotworkspace-deploy-1.0.0-beta.1.zip",
    );
    assert.equal(
      releaseNotesUrl(env),
      "https://github.com/WeGotWorkspace/wegotworkspace/releases/tag/v1.0.0-beta.1",
    );
  });

  it("prefers an explicit notes URL", () => {
    const env = {
      WGW_RELEASE_TAG: "channel-edge",
      WGW_RELEASE_NOTES_URL: "https://example.test/commit/abc",
    };
    assert.equal(releaseNotesUrl(env), "https://example.test/commit/abc");
  });
});
