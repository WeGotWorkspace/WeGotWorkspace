import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { CHAT_COMPOSER_BASIC } from "@/chat-ui/src/chat-composer-allow";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import * as chromeFocus from "@/text-editor-core/src/text-editor-chrome-focus";

function renderComposer(props: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  const onSend = props.onSend ?? vi.fn();
  return render(
    <TooltipProvider delayDuration={0}>
      <ChatComposer onSend={onSend} {...props} />
    </TooltipProvider>,
  );
}

async function waitForEditor() {
  return waitFor(() => {
    const prose = document.querySelector(".ProseMirror");
    expect(prose).toBeInstanceOf(HTMLElement);
    return prose as HTMLElement;
  });
}

describe("ChatComposer chrome focus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates sheet padding mousedown to editor focus and is not a tab stop", async () => {
    const spy = vi.spyOn(chromeFocus, "focusTextEditorFromChromeEvent");
    renderComposer();
    await waitForEditor();
    const sheet = document.querySelector(".chat-composer__sheet");
    const card = document.querySelector(".chat-composer__card");
    expect(sheet).toBeInstanceOf(HTMLElement);
    expect(card?.getAttribute("tabindex")).toBeNull();

    fireEvent.mouseDown(sheet!);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.results.at(-1)?.value).toBe(true);
  });

  it("has no format bar; the row's empty chrome focuses the editor", async () => {
    const spy = vi.spyOn(chromeFocus, "focusTextEditorFromChromeEvent");
    renderComposer();
    await waitForEditor();
    expect(document.querySelector(".text-editor-format-bar")).toBeNull();
    const row = await waitFor(() => {
      const el = document.querySelector(".chat-composer__row");
      expect(el).toBeInstanceOf(HTMLElement);
      return el as HTMLElement;
    });

    fireEvent.mouseDown(row);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.results.at(-1)?.value).toBe(true);
  });

  it("does not steal mousedown from the Send button", async () => {
    const spy = vi.spyOn(chromeFocus, "focusTextEditorFromChromeEvent");
    renderComposer({ initialContent: "Hello there" });
    await waitForEditor();

    fireEvent.mouseDown(screen.getByRole("button", { name: chatUiLabels.send }));

    expect(spy.mock.results.every((result) => result.value === false)).toBe(true);
  });

  it("still sends from the Send button", async () => {
    const onSend = vi.fn();
    renderComposer({ initialContent: "Hello there", onSend });
    await waitForEditor();

    fireEvent.click(screen.getByRole("button", { name: chatUiLabels.send }));

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: "Hello there" }));
  });

  it("sends mentions on Enter for people that load after mount", async () => {
    const onSend = vi.fn();
    const { rerender } = renderComposer({ initialContent: "Hi @Sam de Vries", onSend });
    const prose = await waitForEditor();
    // The directory arrives later, as it does in Chat and threads.
    rerender(
      <TooltipProvider delayDuration={0}>
        <ChatComposer
          initialContent="Hi @Sam de Vries"
          onSend={onSend}
          principals={[{ id: "member", displayName: "Sam de Vries" }]}
        />
      </TooltipProvider>,
    );

    fireEvent.keyDown(prose, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ mentions: [{ id: "member", displayName: "Sam de Vries" }] }),
    );
  });

  describe("editing a stored body", () => {
    const stored = "~~old~~ new\n\n# Agenda\n\n- [ ] item";

    it("keeps formatting the restricted schema cannot write", async () => {
      const onSend = vi.fn();
      renderComposer({ initialContent: stored, allow: CHAT_COMPOSER_BASIC, onSend });
      const prose = await waitForEditor();
      const editor = (prose as unknown as { editor: Editor }).editor;
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "x");

      fireEvent.keyDown(prose, { key: "Enter" });

      const body = onSend.mock.calls[0][0].body as string;
      expect(body).toContain("~~old~~");
      expect(body).toContain("# Agenda");
      expect(body).toMatch(/- \[ \] item/);
    });

    it("sends the stored body unchanged when nothing was edited", async () => {
      const onSend = vi.fn();
      renderComposer({ initialContent: stored, allow: CHAT_COMPOSER_BASIC, onSend });
      const prose = await waitForEditor();

      fireEvent.keyDown(prose, { key: "Enter" });

      expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: stored }));
    });
  });
});
