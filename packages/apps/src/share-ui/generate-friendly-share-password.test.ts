import { describe, expect, it } from "vitest";
import { generateFriendlySharePassword } from "@/share-ui/generate-friendly-share-password";

describe("generateFriendlySharePassword", () => {
  it("returns word-word-number style passwords", () => {
    const password = generateFriendlySharePassword();
    expect(password).toMatch(/^[a-z]+(-[a-z]+){1,2}-\d{3}$/);
  });

  it("generates varied passwords across calls", () => {
    const passwords = new Set(Array.from({ length: 12 }, () => generateFriendlySharePassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });
});
