import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
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

  it("delegates empty format-bar chrome mousedown to editor focus", async () => {
    const spy = vi.spyOn(chromeFocus, "focusTextEditorFromChromeEvent");
    renderComposer();
    await waitForEditor();
    const bar = await waitFor(() => {
      const el = document.querySelector(".chat-composer__bar");
      expect(el).toBeInstanceOf(HTMLElement);
      return el as HTMLElement;
    });

    fireEvent.mouseDown(bar);

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
});
