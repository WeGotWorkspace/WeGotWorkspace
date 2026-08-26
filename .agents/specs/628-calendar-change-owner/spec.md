Source: #628 (body-hash: 0d555a31)
Goal: #615

# Change the owner of an existing calendar

`Calendar/set` update already patches name, color, and `shareWith`. Owner scope (`groupSlug`) is create-only today; the edit dialog disables the same Owner control. This task makes `groupSlug` a patchable field that moves the owner `calendarinstances` row between `principals/{user}` and `principals/groups/{slug}` without deleting the collection.

## Goal

Owners (and group members with `mayShare`) can transfer an existing calendar between personal and group scopes from the calendar dialog. Events stay on the same `calendarid`; `shareWith` grants and ICS/webcal subscriptions on that collection are kept. After transfer the collection lives under the new principal; the previous personal owner keeps access only via group membership or an existing share.

## Non-goals

- Create-time Owner pick (already shipped)
- Person-to-person transfer (Owner options stay Me + groups, same as create)
- Share ACL without ownership change (#403 / #606)
- Delegation / act-as-owner (#492)

## Affected packages

- packages/api
- packages/apps

## Technical constraints

- OpenAPI `CalendarPatch` gains `groupSlug` (`string | null`); omit = no change, `null` = personal of the caller
- Transfer updates `calendarinstances.principaluri` on the owner row only — do not copy events or recreate the calendar
- Reject: sharees, subscriptions, personal `default`, provisioned group calendar (`group-{slug}`), target group the caller is not a member of, URI collision on the target principal
- UI: enable `OwnerScopeField` on edit only when `canChangeCalendarOwner`; confirm before applying an owner change; forward `groupSlug` on `patchCalendar`
- Owner transfer requires online (same as `shareWith`)

## Edge cases

- Personal → group the owner belongs to: they still manage via group membership
- Group → caller’s personal: other members lose the collection unless they have a share
- Target URI already exists (including the provisioned group calendar URI = group slug): `alreadyExists`
- Sharee `groupSlug` patch: `forbidden`
