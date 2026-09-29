import { beforeEach, describe, expect, it, vi } from "vitest";
import { wgwApplyTokenResponse, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { saveSettingsProfile } from "@/lib/api/wgw/settings";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
  wgwFetchPrincipal: vi.fn(),
  wgwApplyTokenResponse: vi.fn(),
}));

const settingsState = {
  user: { username: "alice", displayName: "Alice", email: "alice@example.test" },
  groups: [],
  mail: { imapUsername: "", imapHasPassword: false },
  mailServer: {
    imapHost: "",
    imapPort: 993,
    imapSecurity: "ssl",
    smtpHost: "",
    smtpPort: 465,
    smtpSecurity: "ssl",
  },
  logoutUrl: "/logout",
  mcpEnabled: false,
};

describe("saveSettingsProfile", () => {
  beforeEach(() => {
    vi.mocked(wgwApplyTokenResponse).mockClear();
    vi.mocked(wgwFetch).mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("stores the token pair returned after a password change", async () => {
    vi.mocked(wgwReadJson).mockResolvedValue({
      ...settingsState,
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      refresh_expires_in: 1209600,
    });

    await saveSettingsProfile({ password: "newpassword12" });

    expect(wgwApplyTokenResponse).toHaveBeenCalledWith({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      refresh_expires_in: 1209600,
    });
  });

  it("leaves the current session in place when the password did not change", async () => {
    vi.mocked(wgwReadJson).mockResolvedValue(settingsState);

    await saveSettingsProfile({ displayName: "Alice" });

    expect(wgwApplyTokenResponse).not.toHaveBeenCalled();
  });
});
