import { describe, expect, it } from "vitest";
import { shouldRegisterServiceWorker } from "./should-register-service-worker";

describe("shouldRegisterServiceWorker", () => {
  it("always registers in production builds", () => {
    expect(shouldRegisterServiceWorker({ prod: true, hostname: "app.example" })).toBe(true);
  });

  it("registers on local Vite hosts so pnpm dev can receive Web Push", () => {
    expect(shouldRegisterServiceWorker({ prod: false, hostname: "127.0.0.1" })).toBe(true);
    expect(shouldRegisterServiceWorker({ prod: false, hostname: "localhost" })).toBe(true);
    expect(shouldRegisterServiceWorker({ prod: false, hostname: "::1" })).toBe(true);
  });

  it("registers on *.localhost so Docker HTTPS (wegotworkspace.localhost) can receive Web Push", () => {
    expect(shouldRegisterServiceWorker({ prod: false, hostname: "wegotworkspace.localhost" })).toBe(
      true,
    );
  });

  it("does not register on LAN Vite hosts (HTTP is not a secure origin)", () => {
    expect(shouldRegisterServiceWorker({ prod: false, hostname: "192.168.1.10" })).toBe(false);
  });
});
