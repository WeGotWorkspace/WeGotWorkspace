# Calendar subscription collisions (#2367)

Calendar uris are only unique per owning principal. Before the fix, `calendar_subscriptions`
was unique on `(username, calendar_uri)`, so subscribing a feed into a Team could collide with a
personal calendar (or another Team's calendar) of the same name. The request failed, and the
clean-up removed the calendar it found by bare uri: the user's existing subscription.

The key is now `(principal_uri, calendar_uri)`, where `principal_uri` is the principal that owns the
calendar (`principals/<user>` or `principals/groups/<slug>`). `username` stays the member who made the
subscription. Refresh, delete and failure clean-up address the calendar by principal and uri.

The migration fills `principal_uri` for existing rows: the user's personal principal when they own a
calendar with that uri, otherwise the Team calendar picked by the user's Team membership, then by
calendar name, then by the first one no other row claimed. The old key could keep only one row per
user and uri, so a row the old clean-up already deleted is gone, and a surviving row may point at a
same-named calendar of another principal when none of those hints settle it. If the migration stopped
half way it finishes on the next run.

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

Subscriptions that now point at a calendar with a different name (the backfill could not tell two
same-named calendars apart and picked another one):

```sql
SELECT cs.id, cs.username, cs.principal_uri, cs.calendar_uri, cs.name AS subscription_name, ci.displayname
FROM calendar_subscriptions cs
JOIN calendarinstances ci
  ON ci.principaluri = cs.principal_uri AND ci.uri = cs.calendar_uri AND ci.access = 1
WHERE cs.name IS NOT NULL AND cs.name <> ci.displayname;
```

Rows from the first query whose calendar was lost may also have been backfilled to the user's personal
principal; they show up there because no owner calendar exists. A lost subscription itself leaves no row, so it cannot be listed. Users who report one can subscribe
to the feed again; it no longer collides.
