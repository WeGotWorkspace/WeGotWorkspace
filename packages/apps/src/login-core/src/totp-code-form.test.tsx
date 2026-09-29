// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryCodeForm, TotpCodeForm } from "@/login-core/src/totp-code-form";
import { digitsOnly } from "@/login-core/src/totp-format";

describe("TotpCodeForm", () => {
  afterEach(() => cleanup());

  it("exposes one authenticator field and a hidden username", () => {
    render(<TotpCodeForm username="alice" onSubmit={vi.fn()} />);
    const otp = screen.getByLabelText("Authentication code");
    expect(otp.getAttribute("name")).toBe("otp");
    expect(otp.getAttribute("autocomplete")).toBe("one-time-code");
    expect(otp.getAttribute("inputmode")).toBe("numeric");
    expect(otp.getAttribute("pattern")).toBe("[0-9]*");
    expect(otp.getAttribute("maxlength")).toBe("6");
    const username = document.querySelector('input[name="username"]');
    expect(username?.getAttribute("autocomplete")).toBe("username");
    expect(username?.hasAttribute("hidden")).toBe(true);
    expect((username as HTMLInputElement | null)?.readOnly).toBe(true);
  });

  it("strips spaces and submits at six digits", () => {
    const onSubmit = vi.fn();
    render(<TotpCodeForm username="alice" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Authentication code"), {
      target: { value: "123 456" },
    });
    expect(onSubmit).toHaveBeenCalledWith("123456");
    expect(digitsOnly("12 34 56")).toBe("123456");
  });
});

describe("RecoveryCodeForm", () => {
  afterEach(() => cleanup());

  it("does not offer one-time-code autocomplete", () => {
    render(<RecoveryCodeForm username="alice" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Recovery code").getAttribute("autocomplete")).toBe("off");
  });
});
