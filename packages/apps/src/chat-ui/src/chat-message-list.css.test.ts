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
    expect(tsx).toMatch(/emphasis=\{day\.emphasis\}/);
    expect(tsx).toMatch(/rest=\{day\.rest\}/);
    expect(tsx).not.toMatch(/chat-message-list__day-label/);
    expect(css).toMatch(/--list-sticky-header-bg:\s*#ffffff/);
    expect(css).not.toMatch(/--list-sticky-header-font-size/);
    expect(css).not.toMatch(/--list-sticky-header-color/);
    expect(css).not.toMatch(/chat-message-list__day-label/);
    expect(css).not.toMatch(/rounded-full/);
    expect(css).not.toMatch(/font-\[650\]/);
    expect(css).not.toMatch(/font-\[450\]/);
  });

  it("anchors a New messages jump chip at the bottom of a relative list", () => {
    expect(tsx).toMatch(/onCaughtUpChange\?:/);
    expect(tsx).toMatch(/chatUiLabels\.newMessages/);
    expect(tsx).toMatch(/chat-message-list__jump/);
    expect(css).toMatch(/\.chat-message-list \{[\s\S]*relative/);
    expect(css).toMatch(/\.chat-message-list__jump[\s\S]*absolute/);
  });
});
