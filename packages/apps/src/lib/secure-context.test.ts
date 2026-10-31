import { describe, expect, it } from "vitest";
import { isPageSecureContext } from "@/lib/secure-context";

function page(protocol: string, hostname: string) {
  return { location: { protocol, hostname } };
}

describe("isPageSecureContext", () => {
  it("takes the browser's answer when it has one", () => {
    expect(isPageSecureContext({ isSecureContext: true, ...page("http:", "192.168.1.5") })).toBe(
      true,
    );
    expect(isPageSecureContext({ isSecureContext: false, ...page("https:", "example.org") })).toBe(
      false,
    );
  });

  it("counts https and localhost as secure without isSecureContext", () => {
    for (const [protocol, host] of [
      ["https:", "team.example.org"],
      ["http:", "localhost"],
      ["http:", "127.0.0.1"],
      ["http:", "[::1]"],
      ["http:", "wgw.localhost"],
    ]) {
      expect(isPageSecureContext(page(protocol, host)), `${protocol}//${host}`).toBe(true);
    }
  });

  it("counts plain http on any other host as not secure", () => {
    for (const host of ["192.168.1.5", "team.example.org", "wgw.test"]) {
      expect(isPageSecureContext(page("http:", host)), host).toBe(false);
    }
  });
});
