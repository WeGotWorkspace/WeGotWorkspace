import { isApiError } from "@/lib/api/api-error";
import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { createMockTwoFactorOperations } from "@/lib/api/mock/two-factor-settings";
import { AppPasswordThrottledError } from "@/lib/api/wgw/app-passwords";
import { wgwCompleteLogoutNavigation, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createWgwTwoFactorOperations,
  type TwoFactorOperations,
  type TwoFactorSetup,
} from "@/lib/api/wgw/two-factor-settings";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { twoFactorSettingsLabels as labels } from "@/settings-core/src/settings-two-factor-labels";

/** Live REST with an API; an in-memory account otherwise. */
export function defaultTwoFactorOperations(): TwoFactorOperations {
  return createWorkspaceSource<TwoFactorOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwTwoFactorOperations,
    createMockSource: mocksInBuild ? () => createMockTwoFactorOperations() : mocksNotInBuild,
  });
}

/** The login screen shows a message for this notice after two-factor was turned on. */
export const TWO_FACTOR_ON_NOTICE = "two-factor-on";

/** After turning it on: this browser is signed out too, then the login screen says why. */
export async function signOutAfterTwoFactorOn(): Promise<void> {
  const navigation = await wgwCompleteLogoutNavigation();
  if (navigation === "member_login") {
    window.location.assign(`/login?notice=${TWO_FACTOR_ON_NOTICE}`);
  }
}

/** Which dialog is open, and on which step. */
export type TwoFactorDialog =
  | { kind: "setup-password"; unsynced: number | null }
  | { kind: "setup-scan"; setup: TwoFactorSetup }
  | { kind: "codes"; codes: string[]; signOut: boolean }
  | { kind: "disable" }
  | { kind: "replace" };

/** Where a failure shows: under the account password, under the code, or in a toast. */
export type TwoFactorFailure = {
  field: "password" | "code" | null;
  message: string;
  wrongCode: boolean;
};

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ms);
}

/** From the status and the server's code, never the message. */
export function twoFactorFailure(
  error: unknown,
  step: "password" | "code",
  now = Date.now(),
): TwoFactorFailure {
  const at = (seconds: number) => formatTime(now + seconds * 1000);
  if (error instanceof AppPasswordThrottledError) {
    const message =
      error.code === "mfa_locked"
        ? labels.codesPaused(at(error.retryAfterSeconds))
        : labels.throttled(at(error.retryAfterSeconds));
    return { field: step, message, wrongCode: false };
  }
  if (isFetchNetworkError(error)) {
    return { field: null, message: labels.offlineAction, wrongCode: false };
  }
  if (!isApiError(error)) return { field: null, message: labels.failed, wrongCode: false };
  if (error.status === 403)
    return { field: "password", message: labels.wrongPassword, wrongCode: false };
  if (error.status === 409) return { field: null, message: labels.alreadyOn, wrongCode: false };
  if (error.code === "mfa_code_invalid" || error.status === 422) {
    return { field: "code", message: labels.wrongCode, wrongCode: true };
  }
  if (error.status === 429) {
    return { field: step, message: labels.throttled(at(60)), wrongCode: false };
  }
  return { field: null, message: labels.failed, wrongCode: false };
}
