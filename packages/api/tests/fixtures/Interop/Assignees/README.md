# Assignee interop fixtures (#2172)

Hand-written in the shape real clients use. These are **not** captures; real-client captures live in [`../RealClients/`](../RealClients/README.md).

| File | Shape of | Used by |
|---|---|---|
| `thunderbird-shaped-todo.ics` | Thunderbird 158 task with an organizer and two attendees (`PRODID` Mozilla Calendar, `X-MOZ-GENERATION`, `RSVP`/`CN`/`PARTSTAT`/`ROLE` in Thunderbird's order) | `TaskAssigneesInteropTest` |

The Apple Reminders round trip in `TaskAssigneesInteropTest` uses the real capture `../RealClients/apple-reminders-macos26-todo.before.ics`. That test proves the web app's assign keeps everything Reminders wrote. Whether Reminders then keeps the server's `ATTENDEE` on its own edit needs a fresh capture from a device.
