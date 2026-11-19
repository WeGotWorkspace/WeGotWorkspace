import {
  AppPasswordThrottledError,
  type AppPassword,
  type AppPasswordOperations,
} from "@/lib/api/wgw/app-passwords";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/** The account password the mock accepts; `wrong` is refused, `throttled` trips the limit. */
export const MOCK_ACCOUNT_PASSWORD = "storybook-dev";

export const MOCK_APP_PASSWORDS: AppPassword[] = [
  {
    id: 3,
    name: "iPhone calendar",
    createdAt: "2026-11-12T08:14:00Z",
    lastUsedAt: "2026-11-19T07:52:00Z",
    lastUsedClient: "iOS/18.1 (22B83) dataaccessd/1.0",
  },
  {
    id: 2,
    name: "Thunderbird on the laptop",
    createdAt: "2026-10-30T16:02:00Z",
    lastUsedAt: "2026-11-18T21:40:00Z",
    lastUsedClient: "Thunderbird/128.4",
  },
  {
    id: 1,
    name: "Old Android",
    createdAt: "2026-06-03T10:00:00Z",
    lastUsedAt: null,
    lastUsedClient: null,
  },
];

function mockPlaintext(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 16; i += 1) out += letters[Math.floor(Math.random() * letters.length)];
  return out;
}

/**
 * In-memory stand-in for `/api/v1/settings/app-passwords` with the server's rules: create
 * needs the account password (403 `current_password_invalid` otherwise, 429 for `throttled`),
 * the plaintext comes back once, the newest is listed first. `failList` makes the list fail.
 */
export function createMockAppPasswordOperations(
  initial: AppPassword[] = [],
  options: { failList?: boolean; latencyMs?: number } = {},
): AppPasswordOperations {
  let rows = [...initial];
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const wait = () =>
    options.latencyMs ? new Promise((resolve) => setTimeout(resolve, options.latencyMs)) : null;
  return {
    list: async () => {
      await wait();
      if (options.failList) throw new WgwRequestError("GET failed (500)", 500);
      return [...rows];
    },
    create: async ({ name, currentPassword }) => {
      await wait();
      if (currentPassword === "throttled") {
        throw new AppPasswordThrottledError("Too many attempts", null, "throttled");
      }
      if (currentPassword !== MOCK_ACCOUNT_PASSWORD) {
        throw new WgwRequestError(
          "Current password is incorrect.",
          403,
          "current_password_invalid",
        );
      }
      const appPassword: AppPassword = {
        id: nextId++,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        lastUsedClient: null,
      };
      rows = [appPassword, ...rows];
      return { password: mockPlaintext(), appPassword };
    },
    revoke: async (id) => {
      await wait();
      rows = rows.filter((row) => row.id !== id);
    },
    revokeAll: async () => {
      await wait();
      rows = [];
    },
  };
}
