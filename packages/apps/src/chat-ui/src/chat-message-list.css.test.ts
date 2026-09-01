import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "chat-message-list.css"), "utf8");
const tsx = readFileSync(join(here, "chat-message-list.tsx"), "utf8");

describe("chat-message-list day chrome", () => {
  it("uses the shared sticky list header instead of a floating date pill", () => {
    expect(tsx).toMatch(
      /import \{ ListStickyHeader \} from "@\/list-sticky-header\/src\/list-sticky-header"/,
    );
    expect(tsx).toMatch(/groupChatMessagesByDay/);
    expect(tsx).toMatch(/<ListStickyHeader/);
    expect(tsx).not.toMatch(/chat-message-list__day-label/);
    expect(css).toMatch(/--list-sticky-header-bg:\s*#ffffff/);
    expect(css).toMatch(/--list-sticky-header-font-size:\s*0\.9375rem/);
    expect(css).not.toMatch(/chat-message-list__day-label/);
    expect(css).not.toMatch(/rounded-full/);
  });
});
