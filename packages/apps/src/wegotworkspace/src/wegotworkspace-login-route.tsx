import { redirect } from "@tanstack/react-router";
import { ForgotPasswordScreen } from "@/login-core/src/forgot-password-screen";
import { LoginScreen } from "@/login-core/src/login-screen";
import { ResetPasswordScreen } from "@/login-core/src/reset-password-screen";
import { wgwHasAuthenticatedSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { sanitizeWgwReturnPath } from "@/lib/api/wgw/route-guard";

export type LoginSearch = {
  return?: string;
};

export type ResetPasswordSearch = {
  token?: string;
};

export function loginRouteBeforeLoad({ search }: { search: LoginSearch }) {
  if (!wgwLiveApiEnabled()) return;
  if (!wgwHasAuthenticatedSession()) return;
  const returnPath = sanitizeWgwReturnPath(search.return);
  throw redirect({ to: returnPath });
}

export function WeGotWorkspaceLoginRoute() {
  return <LoginScreen />;
}

export function WeGotWorkspaceForgotPasswordRoute() {
  return <ForgotPasswordScreen />;
}

export function WeGotWorkspaceResetPasswordRoute() {
  return <ResetPasswordScreen />;
}
