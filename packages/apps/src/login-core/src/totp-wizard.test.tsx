import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TotpWizardSource } from "@/lib/api/wgw/mfa-client";
import { TotpWizard } from "@/login-core/src/totp-wizard";

const provision = {
  secret: "ABCDEFGHIJKLMNOP",
  otpauthUri: "otpauth://totp/WeGotWorkspace:alice?secret=ABCDEFGHIJKLMNOP",
  davWarning: false,
};

function source(overrides: Partial<TotpWizardSource> = {}): TotpWizardSource {
  return {
    mode: "enroll",
    username: "alice",
    presentation: "challenge",
    forced: true,
    start: vi.fn().mockResolvedValue(provision),
    confirm: vi.fn().mockResolvedValue({ recoveryCodes: [] }),
    ...overrides,
  };
}

describe("TotpWizard", () => {
  afterEach(() => {
    cleanup();
  });

  it("asks for the account password before showing a secret", () => {
    render(
      <TotpWizard source={source()} onFinished={() => undefined} onLogout={() => undefined} />,
    );

    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByText("ABCD EFGH IJKL MNOP")).toBeNull();
  });

  it("skips the password step when sign-in already collected it", async () => {
    const start = vi.fn().mockResolvedValue(provision);
    render(
      <TotpWizard
        source={source({ knownPassword: "secret", start })}
        onFinished={() => undefined}
        onLogout={() => undefined}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Password" })).toBeNull();
    await waitFor(() => {
      expect(start).toHaveBeenCalledWith("secret");
    });
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeTruthy();
  });

  it("keeps spaces around the password collected at sign-in", async () => {
    const start = vi.fn().mockResolvedValue(provision);
    render(
      <TotpWizard
        source={source({ knownPassword: " secret ", start })}
        onFinished={() => undefined}
        onLogout={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(" secret ");
    });
  });
});
