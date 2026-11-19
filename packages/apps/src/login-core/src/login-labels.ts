/** Copy for the login screen and its second step (#2274). */
export const loginLabels = {
  welcome: "Welcome back.",
  connect: "Connect Assistant",
  twoFactorOn:
    "Two-factor sign-in is on. Sign in again with your password and a code from your app.",
  codeTitle: "One more step.",
  replaceTitle: "Set up your app again.",
  codesTitle: "Save your new recovery codes.",
  codeLead: "Enter the 6-digit code from your authenticator app.",
  recoveryLead: "Enter one of the recovery codes you saved when you turned on two-factor sign-in.",
  replaceLead:
    "That recovery code is now used up. Scan this QR code with your authenticator app, then enter the code it shows.",
  codesLead:
    "Your old recovery codes no longer work. Each of these works once, when your phone is not at hand.",
  useRecovery: "Use a recovery code",
  useApp: "Use a code from the app",
  startOver: "Sign in as someone else",
  verify: "Verify",
  verifying: "Verifying...",
  continue: "Continue",
  signIn: "Sign in",
  signingIn: "Signing in...",
  loadingSecret: "Preparing a new authenticator...",
  required: "Username and password are required.",
  codeRequired: "Enter the 6-digit code from your app.",
  recoveryRequired: "Enter a recovery code.",
  invalid: "That username or password does not match this server.",
  wrongCode: "That code does not match.",
  expired: "The sign-in took too long. Enter your password again.",
  throttled: (at: string | null) =>
    at
      ? `Too many sign-in attempts. Try again at ${at}.`
      : "Too many sign-in attempts. Wait a few minutes and try again.",
  codesPaused: (at: string | null) =>
    at
      ? `Code entry is paused after too many wrong codes. Try again at ${at}.`
      : "Code entry is paused after too many wrong codes. Try again in an hour.",
  offline: "You are offline. Connect to the internet and try again.",
  failed: "Could not sign in.",
} as const;
