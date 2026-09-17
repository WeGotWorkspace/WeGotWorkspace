import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "drive-item-icon-button.tsx"), "utf8");

describe("DriveItemIconButton", () => {
  it("defaults to outline so Drive row chrome matches header peers", () => {
    expect(source).toMatch(/variant = "outline"/);
    expect(source).not.toMatch(/variant = "subtle"/);
  });
});
