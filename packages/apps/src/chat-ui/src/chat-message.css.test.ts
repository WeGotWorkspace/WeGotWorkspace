import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "chat-message.css"), "utf8");
const tsx = readFileSync(join(here, "chat-message.tsx"), "utf8");
const listCss = readFileSync(join(here, "chat-message-list.css"), "utf8");
const composerCss = readFileSync(join(here, "chat-composer.css"), "utf8");
const mentionTsx = readFileSync(join(here, "chat-mention-menu.tsx"), "utf8");
const chatUiCss = readFileSync(join(here, "chat-ui.css"), "utf8");

describe("chat-message avatar chrome", () => {
  it("hashes author / mention ids through avatarColorForUserId without ink wash overrides", () => {
    expect(tsx).toMatch(/<UserAvatar/);
    expect(tsx).toMatch(/color=\{avatarColorForUserId\(message\.authorId\)\}/);
    expect(mentionTsx).toMatch(/color=\{avatarColorForUserId\(principal\.id\)\}/);
    expect(chatUiCss).not.toMatch(/--user-avatar-bg:/);
    expect(chatUiCss).not.toMatch(/--user-avatar-fg:/);
  });

  it("top-aligns the avatar with the author row even when replies/reactions grow the body", () => {
    expect(css).toMatch(/\.chat-message \{[\s\S]*?@apply[^;]*\bitems-start\b/);
    expect(css).toMatch(/\.chat-message__avatar \{[\s\S]*?@apply[^;]*\bpt-0\.5\b/);
  });
});

describe("chat-message continuation spacing", () => {
  it("keeps full row padding on the lead message", () => {
    expect(css).toMatch(/\.chat-message \{[\s\S]*?@apply[^;]*\bpy-2\.5\b/);
  });

  it("stacks same-author continuations with Slack-like padding-block", () => {
    expect(css).toMatch(/\.chat-message--continuation \{\s*@apply py-0\.5;\s*\}/);
    expect(css).not.toMatch(/\.chat-message--continuation \{\s*@apply pt-0;/);
  });

  it("does not let the avatar gutter or hover time reserve a header line", () => {
    expect(css).toMatch(/\.chat-message__avatar-spacer \{[\s\S]*?@apply[^;]*\bw-9\b/);
    expect(css).not.toMatch(/\.chat-message__avatar-spacer \{[\s\S]*?@apply[^;]*\bsize-9\b/);
    expect(css).toMatch(/\.chat-message--continuation \.chat-message__time \{[\s\S]*?\babsolute\b/);
  });

  it("keeps author-group and day-header separation on the list", () => {
    expect(listCss).toMatch(
      /\.chat-message-list__group \+ \.chat-message-list__group \{[\s\S]*?\bmt-2\b/,
    );
  });

  it("keeps hover actions visible while the reaction picker is open", () => {
    expect(css).toMatch(
      /\.chat-message:has\(\[data-state="open"\]\) \.chat-message__actions \{\s*display:\s*flex;/,
    );
  });

  it("lifts hovered/focused rows above sticky day headers so short-message actions stay visible", () => {
    expect(css).toMatch(
      /\.chat-message:hover,\s*\.chat-message:focus-within \{[\s\S]*?z-index:\s*6;/,
    );
    expect(css).toMatch(/\.chat-message:has\(\[data-state="open"\]\) \{[\s\S]*?z-index:\s*6;/);
  });

  it("wraps message body text instead of overflowing a narrow rail", () => {
    expect(css).toMatch(/\.chat-message__body \{[\s\S]*?break-words/);
    expect(css).toMatch(/\.chat-message__body \{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(listCss).toMatch(/\.chat-message-list \{[\s\S]*?min-w-0/);
    expect(listCss).toMatch(/\.chat-message-list__scroll \{[\s\S]*?overflow-x-hidden/);
    expect(composerCss).toMatch(/\.text-editor-format-bar \{[\s\S]*?min-w-0/);
    expect(composerCss).toMatch(/\.chat-composer__hint \{[\s\S]*?break-words/);
  });
});
