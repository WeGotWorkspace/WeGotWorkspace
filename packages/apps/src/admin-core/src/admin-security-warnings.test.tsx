import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSecurityWarnings } from "@/admin-core/src/admin-workspace";
import { isLoopbackOrigin } from "@/admin-core/src/admin-workspace-utils";

const APP_URL_WARNING =
  "APP_URL is not set; the Host header is not validated and password-reset mail is disabled.";
const LOCAL_APP_URL_WARNING =
  "APP_URL is a local address (http://localhost:8080). Host checks and password-reset mail stay off until it is the site's public address: reset links must point there.";

afterEach(() => {
  cleanup();
});

describe("AdminSecurityWarnings", () => {
  it("offers the public address plus the install base and sends it on click", async () => {
    const onUseThisAddress = vi.fn().mockResolvedValue(true);
    render(
      <AdminSecurityWarnings
        warnings={[APP_URL_WARNING]}
        baseUri="/office/"
        origin="https://team.example.org"
        onUseThisAddress={onUseThisAddress}
      />,
    );

    expect(
      screen.getByText(/saves https:\/\/team\.example\.org\/office as the site address/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));

    await waitFor(() => {
      expect(onUseThisAddress).toHaveBeenCalledWith("https://team.example.org/office");
    });
  });

  it("keeps the warning until the refreshed state drops it", async () => {
    const onUseThisAddress = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <AdminSecurityWarnings
        warnings={[APP_URL_WARNING]}
        baseUri="/"
        origin="https://team.example.org"
        onUseThisAddress={onUseThisAddress}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => {
      expect(onUseThisAddress).toHaveBeenCalled();
    });
    // The server still reports the warning: it stays.
    expect(screen.getByText(/APP_URL is not set/)).toBeTruthy();

    rerender(
      <AdminSecurityWarnings
        warnings={[]}
        baseUri="/"
        origin="https://team.example.org"
        onUseThisAddress={onUseThisAddress}
      />,
    );
    expect(screen.queryByText(/APP_URL is not set/)).toBeNull();
  });

  it("offers no button without a browser origin", () => {
    render(<AdminSecurityWarnings warnings={[APP_URL_WARNING]} baseUri="/" origin="" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("informs instead of alarming on a local address, and says where to set it", () => {
    render(
      <AdminSecurityWarnings
        warnings={[LOCAL_APP_URL_WARNING]}
        baseUri="/"
        origin="http://localhost:8080"
        onUseThisAddress={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Local address")).toBeTruthy();
    expect(screen.queryByText("Security warning")).toBeNull();
    expect(screen.getByText(/open Admin on the site's public address/)).toBeTruthy();
    expect(screen.getByText(/packages\/api\/\.env/)).toBeTruthy();
  });

  it("offers the fix for a local APP_URL when Admin is open on the public address", () => {
    render(
      <AdminSecurityWarnings
        warnings={[LOCAL_APP_URL_WARNING]}
        baseUri="/"
        origin="https://team.example.org"
        onUseThisAddress={vi.fn()}
      />,
    );

    expect(screen.getByText("Security warning")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use this address" })).toBeTruthy();
  });

  it("leaves other security warnings without a button", () => {
    render(
      <AdminSecurityWarnings
        warnings={["APP_DEBUG is on. Error responses can include exception details."]}
        baseUri="/"
        origin="https://team.example.org"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("isLoopbackOrigin", () => {
  it("matches the hosts the API treats as an unset APP_URL", () => {
    for (const origin of [
      "http://localhost:8080",
      "http://127.0.0.1",
      "http://[::1]:9080",
      "https://localhost",
    ]) {
      expect(isLoopbackOrigin(origin), origin).toBe(true);
    }
    for (const origin of ["https://team.example.org", "http://192.168.1.5:8080", "not a url"]) {
      expect(isLoopbackOrigin(origin), origin).toBe(false);
    }
  });
});
