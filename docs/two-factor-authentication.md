# Two-factor authentication

Two-factor authentication is opt-in for each user. An administrator cannot require it for the workspace.

## Turn it on or off

Open Settings → Security. The two-factor switch starts setup when it is off, and asks for an authenticator code before turning it off. Setup asks for one thing at a time: your account password, the QR code and a 6-digit code, then the recovery codes. Each recovery code works once. Copy them with the copy icon. The home screen does not add a setup button. Sign-in that already accepted the password reuses it when a recovery code starts authenticator replacement.

## Calendar and contacts

After two-factor authentication is on, phone and desktop calendar apps cannot use your account password. Create an app password in Settings → Security and use that in the calendar or contacts account. You can revoke one app password, or all of them, without changing your account password.

## Lost the authenticator

At sign-in, choose "Use a recovery code". That signs you into a one-time setup for a new authenticator. The old authenticator stops working only after you confirm the new one. Other signed-in browsers are signed out at that confirmation.

If you have no recovery codes left, ask an administrator to reset two-factor authentication for your account. The sign-in screen says "Lost access? Ask your admin."

Ten wrong authenticator or recovery codes in an hour lock sign-in for that hour, including a later correct code.
