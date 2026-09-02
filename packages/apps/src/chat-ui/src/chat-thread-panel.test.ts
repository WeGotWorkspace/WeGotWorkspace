import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "chat-thread-panel.tsx"), "utf8");
const message = readFileSync(join(here, "chat-message.tsx"), "utf8");
const column = readFileSync(join(here, "../../meet-core/src/meet-chat-column.tsx"), "utf8");

describe("ChatThreadPanel nesting", () => {
  it("does not open a nested thread from messages already in the panel", () => {
    expect(tsx).toMatch(/allowThread=\{false\}/);
    expect(tsx).toMatch(/omitChatNestedThreadActions/);
    expect(tsx).not.toMatch(/onOpenThread=/);
  });

  it("keeps Reply in thread on main-channel messages only", () => {
    expect(message).toMatch(/allowThread = true/);
    expect(message).toMatch(/chatMessageCanOpenThread\(message\)/);
    expect(column).toMatch(/id: "reply"/);
    expect(column).toMatch(/chatMessageCanOpenThread\(message\)/);
  });
});
