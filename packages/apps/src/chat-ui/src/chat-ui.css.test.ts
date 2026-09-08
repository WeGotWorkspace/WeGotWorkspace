import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "chat-ui.css"), "utf8");

describe("chat-ui font tokens", () => {
  it("uses the shared product sans, not a second stack", () => {
    expect(css).toMatch(/\.chat-ui \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/Inter/);
    expect(css).not.toMatch(/ui-sans-serif/);
    expect(css).not.toMatch(/system-ui/);
  });
});
