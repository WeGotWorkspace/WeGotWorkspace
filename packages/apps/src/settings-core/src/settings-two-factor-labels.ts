/** Copy for Settings → Security → Two-factor sign-in (#2275). */
export const twoFactorSettingsLabels = {
  title: "Two-factor sign-in",
  lead: "After your password, the web app and assistant connect also ask for a code from an authenticator app on your phone.",
  loading: "Loading…",
  offline: "You are offline. Two-factor sign-in shows when the connection is back.",
  loadFailed: "Could not load two-factor sign-in.",
  retry: "Try again",
  statusLabel: "Authenticator app",
  statusOn: "On",
  statusOff: "Off",
  statusOnDescription: "Signing in asks for a code from your app",
  statusOffDescription: "Signing in asks for your password only",
  turnOn: "Turn on",
  turnOff: "Turn off",
  codesLabel: "Recovery codes",
  codesLeft: (left: number, total: number) =>
    `${left} of ${total} left. Each one signs you in once without your phone.`,
  codesLeftUnknown: "Each one signs you in once without your phone.",
  codesNoneLeft: "None left. Make new ones while you still have your phone.",
  replaceCodes: "Replace",
  cancel: "Cancel",
  next: "Next",
  turnOnConfirm: "Turn on",
  done: "Done",
  setupTitle: "Turn on two-factor sign-in",
  setupPasswordDescription: "Enter your account password to start.",
  currentPasswordLabel: "Account password",
  currentPasswordRequired: "Enter your account password",
  wrongPassword: "Account password is incorrect",
  signOutNote:
    "Turning it on signs you out everywhere, also here. You sign in again with your password and a code.",
  unsyncedNote: (count: number | null) =>
    count === null
      ? "Changes on this device that are not synced yet will be lost."
      : count === 1
        ? "This device has 1 change that is not synced yet. It will be lost."
        : `This device has ${count} changes that are not synced yet. They will be lost.`,
  scanDescription:
    "Scan the QR code with your authenticator app, then enter the 6-digit code it shows.",
  davWarningTitle: "A calendar or contacts app uses your account password",
  davWarning: (when: string) =>
    `An app signed in with your account password on ${when}. Once two-factor is on, it needs an app password instead.`,
  davWarningAction: "Make an app password first",
  codesTitle: "Save your recovery codes",
  codesDescription: "If you lose your phone, each code signs you in once. They are shown only now.",
  replaceTitle: "Replace recovery codes",
  replaceDescription:
    "Enter a code from your authenticator app. Your old recovery codes stop working.",
  replaceConfirm: "Replace codes",
  disableTitle: "Turn off two-factor sign-in?",
  disableDescription:
    "Enter a code from your authenticator app. Signing in then asks for your password only, and calendar and contacts apps may use your account password again.",
  disableConfirm: "Turn off",
  codeRequired: "Enter the 6-digit code from your app",
  wrongCode: "That code is not right.",
  throttled: (time: string | null) =>
    time ? `Too many tries. Try again at ${time}.` : "Too many tries. Try again later.",
  alreadyOn: "Two-factor sign-in is already on. Reload the page to see it.",
  alreadyOff: "Two-factor sign-in is already off. Reload the page to see it.",
  offlineAction: "You are offline. Try again when the connection is back.",
  failed: "Something went wrong. Try again.",
  turnedOff: "Two-factor sign-in is off",
  codesReplaced: "New recovery codes saved",
} as const;
