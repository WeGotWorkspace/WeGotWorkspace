import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("live Mail JMAP source", () => {
  it("does not call sunset mailbox REST routes", () => {
    const source = [
      readFileSync(join(here, "mail-jmap.ts"), "utf8"),
      readFileSync(join(here, "../../../mail-core/src/mail-api-source.ts"), "utf8"),
    ].join("\n");

    expect(source).toContain('"/mail/status"');
    expect(source).not.toMatch(/\/mail\/(folders|messages|move|drafts)/);
  });
});
