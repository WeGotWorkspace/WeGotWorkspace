import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COLLECTION_DETAIL_OVERLAY_MAX_PX } from "./collection-detail-breakpoint";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "workspace-app.css"), "utf8");

describe("collection detail overlay breakpoint", () => {
  it("stays aligned with Tailwind md (48rem) in workspace-app.css", () => {
    expect(COLLECTION_DETAIL_OVERLAY_MAX_PX).toBe(767);
    expect(css).toMatch(/@media \(min-width: 48rem\)/);
  });
});
