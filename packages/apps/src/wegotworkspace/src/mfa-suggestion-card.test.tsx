// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MfaSuggestionCard } from "@/wegotworkspace/src/mfa-suggestion-card";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const account = {
  enabled: false,
  required: false,
  recoveryCodesRemaining: 0,
  suggest: true,
};

describe("MfaSuggestionCard", () => {
  afterEach(() => cleanup());

  it("does not block opening an app", () => {
    const onSelect = vi.fn();
    render(
      <>
        <MfaSuggestionCard account={account} onEnable={() => undefined} onLater={() => undefined} />
        <button type="button" onClick={onSelect}>
          Notes
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
