# Calendar subscription collisions (#2367)

Calendar uris are only unique per owning principal. Before the fix, `calendar_subscriptions`
was unique on `(username, calendar_uri)`, so subscribing a feed into a Team could collide with a
personal calendar (or another Team's calendar) of the same name. The request failed, and the
clean-up removed the calendar it found by bare uri: the user's existing subscription.

The key is now `(principal_uri, calendar_uri)`, where `principal_uri` is the principal that owns the
calendar (`principals/<user>` or `principals/groups/<slug>`). `username` stays the member who made the
subscription. Refresh, delete and failure clean-up address the calendar by principal and uri.

The migration fills `principal_uri` for existing rows. Candidates are the user's own owner instance
with that uri and owner instances on Teams the user currently belongs to. One candidate gets the row,
even when its name differs. With several candidates the row goes to the one whose name equals the
subscription name, if exactly one does. A row is only attached to a calendar when no other row would
claim the same `(principal_uri, calendar_uri)` (two members with a `villa` row of one Team, or a
renamed personal calendar next to a Team calendar the name matches), nor an already filled row holds
it; all the rows contesting it are parked as below. Otherwise the row is not attached to any of them: it gets
`principals/<user>#unresolved-<id>` (or `principals/<user>` when the user owns no calendar with that
uri), which resolves to no calendar, so Refresh answers 404 and never overwrites a guess. With no
candidate the row keeps `principals/<user>`. The old key could keep only one row per user and uri, so
a row the old clean-up already deleted is gone. If the migration stopped half way it finishes on the
next run.

## Finding affected installs

Run these read-only against the wgw database. Tables are `calendarinstances`, `calendarobjects` and
`calendar_subscriptions`; `access = 1` means owner instance.

Team calendars with no subscription row and no events (the empty calendar a failed Team subscribe left):

```sql
SELECT ci.id, ci.principaluri, ci.uri, ci.displayname
FROM calendarinstances ci
LEFT JOIN calendarobjects co ON co.calendarid = ci.calendarid
LEFT JOIN calendar_subscriptions cs
       ON cs.principal_uri = ci.principaluri AND cs.calendar_uri = ci.uri
WHERE ci.access = 1
  AND ci.principaluri LIKE 'principals/groups/%'
  AND cs.id IS NULL
GROUP BY ci.id, ci.principaluri, ci.uri, ci.displayname
HAVING COUNT(co.id) = 0;
```

Review each row: the default Team calendar is expected to be empty and is not an orphan. Other empty
Team calendars can be deleted by a team admin in the app.

Subscriptions that lost their calendar (the user's existing subscription was deleted by the old
clean-up, or the row now points at nothing):

```sql
SELECT cs.id, cs.username, cs.principal_uri, cs.calendar_uri, cs.url
FROM calendar_subscriptions cs
LEFT JOIN calendarinstances ci
       ON ci.principaluri = cs.principal_uri AND ci.uri = cs.calendar_uri AND ci.access = 1
WHERE ci.id IS NULL;
```

Subscriptions that now point at a calendar with a different name (a single candidate whose name
differs, for example a renamed calendar):

```sql
SELECT cs.id, cs.username, cs.principal_uri, cs.calendar_uri, cs.name AS subscription_name, ci.displayname
FROM calendar_subscriptions cs
JOIN calendarinstances ci
  ON ci.principaluri = cs.principal_uri AND ci.uri = cs.calendar_uri AND ci.access = 1
WHERE cs.name IS NOT NULL AND cs.name <> ci.displayname;
```

Rows the backfill could not settle carry `#unresolved-<id>` in `principal_uri` and show up in the second
query; delete the row, then re-subscribe the feed (re-subscribing first makes a calendar with the same uri and is rejected while the row exists). Rows whose calendar was lost sit on the personal principal and show up there too. A lost subscription itself leaves no row, so it cannot be listed. Users who report one can subscribe
to the feed again; it no longer collides.
