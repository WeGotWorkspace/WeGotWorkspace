# Two-factor sign-in

Two-factor sign-in asks for a second thing when you sign in: a 6-digit code from an authenticator app on your phone. Someone who learns your password still cannot sign in without your phone.

It is off until you turn it on, for each person separately. Nothing changes for anyone who leaves it off.

You need an authenticator app, for example the one built into your phone's password manager, Google Authenticator, Microsoft Authenticator, 2FAS or Aegis. Any app that supports "TOTP" codes works.

## Turn it on

1. Open **Settings → Security**.
2. Under **Two-factor sign-in**, click **Turn on** and enter your account password.
3. Scan the QR code with your authenticator app. Can't scan? Type the **setup key** into the app instead.
4. Enter the 6-digit code the app shows, and click **Turn on**.
5. Save your **recovery codes** (see below), tick **I saved these codes somewhere safe**, and click **Done**.

Turning it on signs you out everywhere, also in the browser you are using. Sign in again with your password and a code from the app.

**Before you start:** if a calendar or contacts app on your phone or computer uses your account password, it stops syncing once two-factor is on. The setup tells you when such an app last signed in. Make an app password for it first (see [App passwords](#app-passwords-for-calendar-and-contacts-apps)).

If the app's codes are refused, check that the time on your phone is set automatically. The codes depend on the clock.

## Signing in

After your username and password, the sign-in page asks for the code from your authenticator app. Each code works once and changes every 30 seconds.

Signing in to WeGotWorkspace once keeps you signed in on that device as before. You are not asked for a code again until you sign out or your session ends.

Connecting an AI assistant uses the same two steps: your password, then a code (see [Connect an AI assistant](mcp-connect.md)).

## App passwords for calendar and contacts apps

Calendar, contacts and files apps (Apple Calendar, Thunderbird, DAVx⁵ and similar) cannot ask for a code. With two-factor on, they need an **app password** instead of your account password. You can also use app passwords with two-factor off, for example to give each app its own password.

To make one:

1. Open **Settings → Security**, and under **App passwords** click **Create app password**.
2. Give it a name you will recognise, like "Calendar on my laptop".
3. With two-factor on, enter a code from your authenticator app. With two-factor off, enter your account password.
4. Click **Save**. Copy the app password now: it is shown only once.
5. In the calendar or contacts app, use your normal username and this app password. The spaces in it do not matter.

Make one app password per app or device. The list shows when each was last used and by which app.

- **Revoke** stops one app password right away. That app stops syncing until you give it a new one.
- **Revoke all** stops every app password at once, for example after losing a laptop.

An app password only works for calendar, contacts, files and Meet apps. It never signs in to the web app or connects an assistant.

## Recovery codes

When you turn on two-factor, you get ten recovery codes. Each one signs you in once without your phone. Keep them somewhere safe and separate from your phone, for example in a password manager or printed.

**Settings → Security** shows how many are left. When you are running low, click **Replace** next to **Recovery codes** and enter a code from your app. You get ten new codes, and the old ones stop working.

## Lost or new phone

1. On the sign-in page, enter your password, then click **Use a recovery code** and enter one of your saved codes.
2. Scan the new QR code with the authenticator app on your new phone, and enter the code it shows.
3. Save the ten new recovery codes you get, and click **Continue**.

This signs you out on every other device. Your old phone's codes stop working.

Lost your phone and your recovery codes? Ask an admin to reset two-factor for you (see below). After that, you sign in with your password alone and can turn it on again.

## Turn it off

Open **Settings → Security**, click **Turn off** and enter a code from your authenticator app. Signing in then asks for your password only. Your app passwords keep working, and calendar and contacts apps may use your account password again.

## Too many wrong codes

After 10 wrong codes within an hour, code entry is locked for an hour, also for the right code. The sign-in page says when you can try again.

Calendar and contacts apps that keep sending a wrong or old password are slowed down the same way as before. That never blocks a correct app password, so your other apps keep syncing.

## For admins

### Reset someone's two-factor

Open **Admin → Users** and click the shield icon (**Reset two-factor sign-in**) next to the person, then confirm. The icon only shows for people who have two-factor on, and not for yourself: you turn your own off in Settings.

A reset removes their authenticator and recovery codes and signs them out everywhere. They sign in with their password alone and can set up two-factor again. Their app passwords keep working.

### Reset from the command line

If you are the only admin and lost your phone and recovery codes, reset yourself on the server:

```bash
cd packages/api
php artisan wgw:mfa:reset USERNAME
```

With the Docker install:

```bash
docker compose exec -u www-data web php /var/www/html/packages/api/artisan wgw:mfa:reset USERNAME
```

The reset also helps when the server's `APP_KEY` changed and stored authenticators can no longer be read: those people cannot sign in until they are reset.

### What does not turn it off

A password reset by email, or an admin setting a new password, does not turn two-factor off. Only the person (with a code), an admin reset, or the command above does.

For the API, see [`packages/api/docs/api-auth.md`](../packages/api/docs/api-auth.md#two-factor-sign-in).
