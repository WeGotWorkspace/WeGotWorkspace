import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSecurityWarnings } from "@/admin-core/src/admin-workspace";

const APP_URL_WARNING =
  "APP_URL is not set; the Host header is not validated and password-reset mail is disabled.";

afterEach(() => {
  cleanup();
});

describe("AdminSecurityWarnings", () => {
  it("sends the browser origin plus the install base when Use this address is clicked", async () => {
    const onUseThisAddress = vi.fn().mockResolvedValue(true);
    render(
      <AdminSecurityWarnings
        warnings={[APP_URL_WARNING]}
        baseUri="/office/"
        onUseThisAddress={onUseThisAddress}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));

    await waitFor(() => {
      expect(onUseThisAddress).toHaveBeenCalledWith(`${window.location.origin}/office`);
    });
    await waitFor(() => {
      expect(screen.queryByText(APP_URL_WARNING)).toBeNull();
    });
  });

  it("leaves other security warnings without that button", () => {
    render(
      <AdminSecurityWarnings
        warnings={["APP_DEBUG is on. Error responses can include exception details."]}
        baseUri="/"
      />,
    );
    expect(screen.queryByRole("button", { name: "Use this address" })).toBeNull();
  });
});
