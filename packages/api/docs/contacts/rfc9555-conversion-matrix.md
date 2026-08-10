# RFC 9555 — JSContact ↔ vCard Conversion Matrix

> **Source:** [RFC 9555](https://www.rfc-editor.org/info/rfc9555) (May 2024, Internet Standard)  
> **Updated by:** [RFC 9982](https://www.rfc-editor.org/info/rfc9982) — redefines `uid` conversion for JSContact 2.0 only → see `rfc9982-conversion-matrix.md`  
> **Related:** [RFC 6350](https://www.rfc-editor.org/info/rfc6350) (vCard 4), [RFC 9553](https://www.rfc-editor.org/info/rfc9553) (JSContact), [RFC 9554](https://www.rfc-editor.org/info/rfc9554) (vCard extensions for JSContact)

RFC 9555 remains the normative conversion spec for vCard properties, parameters, and value types. RFC 9982 does not obsolete it; it updates §2.1.1 (`uid` when converting to JSContact version `"2.0"` or later).

Bidirectional conversion reference for implementers. **vCard → JSContact** rules are in §2; **JSContact → vCard** applies reverse rules (§3) plus FN derivation and JSCOMPS/JSPROP extensions.

**Coverage counts:**
- **47 vCard properties** with defined conversion rules (including preserve-only)
- **25 vCard parameters** mapped
- **8 vCard value types** mapped
- **~120 JSContact property paths** in Appendix A reverse table
- **3 RFC 9555 extension properties** (`vCardProps`, `vCardParams`, `vCardName`)
- **2 new vCard elements** (`JSPROP` property, `JSPTR` + `JSCOMPS` parameters)

---

## General rules

### UID generation (vCard → JSContact)

| vCard | JSContact version | `uid` | Rule |
|-------|-------------------|-------|------|
| `UID` present | `"1.0"` | **mandatory** | Copy value (RFC 9555 §2.1.1) |
| `UID` absent | `"1.0"` | **mandatory** | Generate unique id; SHOULD be stable across re-conversions (RFC 9555 §2.1.1) |
| `UID` present | `"2.0"`+ | optional | Copy value |
| `UID` absent | `"2.0"`+ | omitted | **MUST NOT** generate `uid` ([RFC 9982](https://www.rfc-editor.org/info/rfc9982) §5) |

### Multivalue Id keys

| Context | Rule |
|---------|------|
| `Id[…]` map keys | Use `PROP-ID` param if present; else implementation-chosen valid `Id` |

### JSContact → vCard (§3.1)

| Case | FN property rule |
|------|------------------|
| `name.full` set | MUST use as `FN` value |
| `name.full` absent, `components` present | SHOULD derive from components; set `DERIVED=TRUE` on `FN` |
| Neither | `FN` MUST be empty string |

Unknown JSContact properties → `JSPROP` + `JSPTR` (or vendor choice). `vCardProps` applied **after** all standard conversions.

---

## vCard value type conversions

| vCard type | JSContact type | Notes |
|------------|----------------|-------|
| `BOOLEAN` | `Boolean` | |
| `INTEGER` | `Int` / `UnsignedInt` | |
| `FLOAT` | `Number` | |
| `TEXT` | `String` | |
| `URI` | `String` (URI) | |
| `LANGUAGE-TAG` | `String` (RFC 5646 tag) | |
| `TIMESTAMP` | `UTCDateTime` | Except anniversaries → `Timestamp` |
| `DATE` | `PartialDate` | For anniversaries; month-only/day-only → §2.15 |
| `TIME`, `DATE-TIME`, `DATE-AND-OR-TIME` | — | No direct type; property-specific §2.15 |
| `UTC-OFFSET` | `String` (IANA TZ) or — | See TZ §2.8.2; else §2.15 |

---

## vCard parameter → JSContact property

| Parameter | JSContact target | Applies to |
|-----------|------------------|------------|
| `ALTID` | Combines alt instances; verbatim → `vCardParams` | Multi-alt properties |
| `AUTHOR` | `Note.author.uri` | `NOTE` |
| `AUTHOR-NAME` | `Note.author.name` | `NOTE` |
| `CALSCALE` | `PartialDate.calendarScale` | `BDAY`, `DEATHDATE`, `ANNIVERSARY` |
| `CC` | `Address.countryCode` | `ADR` |
| `CREATED` | `Note.created` | `NOTE` |
| `DERIVED` | — (skip conversion if `true`) | Any |
| `GEO` | `Address.coordinates` | `ADR` |
| `GROUP` | — (jCard only); preserve in `vCardParams`/`vCardProps` | Any |
| `INDEX` | `PersonalInfo.listAs`, `Directory.listAs` | `EXPERTISE`, `HOBBY`, `INTEREST`, `ORG-DIRECTORY` |
| `LANGUAGE` | `Card.localizations` | Any (implementation-specific patch strategy) |
| `LABEL` | `Address.full` | `ADR` |
| `LEVEL` | `PersonalInfo.level` | `EXPERTISE` (+ map: beginner→low, average→medium, expert→high) |
| `MEDIATYPE` | `Resource.mediaType` | URI-valued properties |
| `PHONETIC` | `Name`/`Address` `phoneticSystem`; component `phonetic` | `N`, `ADR` |
| `PID` | `vCardParams` | Any |
| `PREF` | `pref` on derived object | Multivalue properties |
| `PROP-ID` | Map key (`Id`) | Multivalue properties |
| `SCRIPT` | `phoneticScript` on `Name`/`Address` | `N`, `ADR` |
| `SERVICE-TYPE` | `OnlineService.service` | `IMPP`, `SOCIALPROFILE` |
| `SORT-AS` | `Name.sortAs`, `Organization.sortAs`, `OrgUnit.sortAs` | `N`, `ORG` |
| `TYPE` | `contexts` and/or `kind` / `features` | Property-specific (see below) |
| `TZ` | `Address.timeZone` | `ADR` |
| `USERNAME` | `OnlineService.user` | `IMPP`, `SOCIALPROFILE` |
| `VALUE` | —; preserve via `vCardProps`/`vCardParams` | Experimental value types |

### TYPE parameter defaults

| vCard TYPE | JSContact |
|------------|-----------|
| `home` | `contexts.private: true` |
| `work` | `contexts.work: true` |
| ADR-specific (`billing`, `delivery` per RFC 9554) | `contexts.billing` / `contexts.delivery` |
| TEL-specific | `Phone.features` keys (see TEL table) |

---

## vCard property → JSContact mapping

### General

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `BEGIN` | — | N/A | Structural |
| `END` | — | N/A | Structural |
| `KIND` | `Card.kind` | Yes | + RFC 6473/6869 values |
| `SOURCE` | `directories` (`kind: entry`) | Yes | `uri` = SOURCE value |
| `XML` | `vCardProps` | Partial | Embedded XML |

### Identification

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `FN` | `name.full` | Partial | Multiple FN → extras to `vCardProps`; LANGUAGE → `localizations` |
| `N` | `name.components` (+ ordering metadata) | Partial | See N component table; `JSCOMPS` on reverse |
| `NICKNAME` | `nicknames` | Yes | |
| `PHOTO` | `media` (`kind: photo`) | Yes | |
| `GENDER` | — / `vCardProps` | **No** | Use `speakToAs` or preserve |
| `GRAMGENDER` | `speakToAs.grammaticalGender` | Yes | Lowercase in JSContact |
| `PRONOUNS` | `speakToAs.pronouns` | Yes | |
| `BDAY` | `anniversaries` (`kind: birth`, `date`) | Partial | DATE/TIMESTAMP/PartialDate rules |
| `BIRTHPLACE` | `anniversaries[].place` (birth) | Partial | `geo:` → `coordinates`; TEXT → `full` |
| `DEATHDATE` | `anniversaries` (`kind: death`, `date`) | Partial | |
| `DEATHPLACE` | `anniversaries[].place` (death) | Partial | Same as BIRTHPLACE |
| `ANNIVERSARY` | `anniversaries` (`kind: wedding`, `date`) | Partial | |

### Delivery addressing

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `ADR` | `addresses` | Partial | Component mapping + `JSCOMPS`; RFC 9554 extended components |

#### ADR structured value ↔ AddressComponent

| ADR component (RFC 6350) | AddressComponent `kind` | Remarks |
|--------------------------|---------------------------|---------|
| PO Box | `postOfficeBox` | Prefer RFC 9554 format on reverse |
| Extended address | `apartment` | Legacy: merge room/floor/apartment/building |
| Street address | `name` | Legacy: merge number/name/block/direction/landmark/subdistrict/district |
| Locality | `locality` | |
| Region | `region` | |
| Postal code | `postcode` | |
| Country | `country` | |
| Apartment | `apartment` | RFC 9554 |
| Block | `block` | RFC 9554 |
| Building | `building` | RFC 9554 |
| Direction | `direction` | RFC 9554 |
| District | `district` | RFC 9554 |
| Floor | `floor` | RFC 9554 |
| Landmark | `landmark` | RFC 9554 |
| Room | `room` | RFC 9554 |
| Street number | `number` | RFC 9554 |
| Subdistrict | `subdistrict` | RFC 9554 |

#### N structured value ↔ NameComponent

| N component | NameComponent `kind` | Reverse remarks |
|-------------|----------------------|-----------------|
| Family name | `surname` | Merge `surname2` into family name |
| Given name | `given` | |
| Additional names | `given2` | |
| Honorific prefix | `title` | |
| Honorific suffix | `credential` | Merge `generation` into suffix |
| Secondary surname | `surname2` | |
| Generation | `generation` | |

### Communications

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `EMAIL` | `emails.address` | Yes | |
| `TEL` | `phones.number` + `features` | Partial | Default vCard voice ≠ default JSContact features |
| `IMPP` | `onlineServices` + `vCardName: impp` | Yes | |
| `SOCIALPROFILE` | `onlineServices` + `vCardName: socialprofile` | Yes | URI→`uri`, else→`user` |
| `LANG` | `preferredLanguages` | Yes | |
| `LANGUAGE` | `Card.language` | Yes | RFC 9554 |

#### TEL TYPE → Phone.features

| vCard TYPE | Phone `features` key |
|------------|---------------------|
| `cell` | `mobile` |
| `fax` | `fax` |
| `main-number` | `main-number` |
| `pager` | `pager` |
| `text` | `text` |
| `textphone` | `textphone` |
| `video` | `video` |
| `voice` | `voice` |

### Geographical

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `GEO` | `Address.coordinates` | Partial | Which address instance: implementation-specific (§2.8.3) |
| `TZ` (TEXT) | `Address.timeZone` | Partial | IANA name |
| `TZ` (UTC-OFFSET) | `Address.timeZone` | Partial | Hour -12…+14, zero minutes only; `Etc/UTC`, `Etc/GMT±N` |
| `TZ` (URI / other offset) | `vCardProps` | **No** | |

#### GEO/TZ/ADR grouping (§2.8.3)

MUST merge into same `Address` when:
- Matching `GROUP` param, OR
- No `GROUP` but other ADR/GEO/TZ have `GROUP` set

### Organizational

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `ORG` | `organizations` | Partial | First component→`name`; rest→`units[]`; empty first for units-only |
| `TITLE` | `titles` (`kind: title`) | Yes | `organizationId` from grouped `ORG` |
| `ROLE` | `titles` (`kind: role`) | Yes | |
| `MEMBER` | `members` | Partial | `PREF` not converted |
| `RELATED` | `relatedTo` | Partial | TEXT values → key with empty `relation` |
| `CONTACT-URI` | `links` (`kind: contact`) | Yes | |
| `LOGO` | `media` (`kind: logo`) | Yes | |

### Personal information

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `EXPERTISE` | `personalInfo` (`kind: expertise`) | Yes | `LEVEL` mapped |
| `HOBBY` | `personalInfo` (`kind: hobby`) | Yes | |
| `INTEREST` | `personalInfo` (`kind: interest`) | Yes | |
| `ORG-DIRECTORY` | `directories` (`kind: directory`) | Yes | |

### Explanatory

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `CATEGORIES` | `keywords` | Partial | `PREF` order not preserved |
| `NOTE` | `notes` | Yes | |
| `PRODID` | `prodId` | Yes | |
| `CREATED` | `created` | Yes | RFC 9554 |
| `REV` | `updated` | Yes | |
| `SOUND` | `media` (`kind: sound`) | Yes | |
| `UID` | `uid` | Yes | |
| `URL` | `links` (no `kind`) | Yes | |
| `VERSION` | `vCardProps` | Partial | |
| `CLIENTPIDMAP` | `vCardProps` | Partial | |
| `X-ABLabel` | `label` on grouped property; also emitted for standard `contexts`/`features` | Partial | **Dual representation:** keep RFC 9554 `PROP-ID` + `TYPE`, and emit Apple `itemN.X-ABLabel` (`Home`/`Work`/`Mobile`/`School`) on write for known standard contexts/features so macOS shows real labels. Custom JSContact `label` still wins. Standard X-ABLabel that matches TYPE is not re-imported as a custom `label`. |

### Security

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `KEY` | `cryptoKeys` | Yes | |

### Calendar

| vCard property | JSContact | Reversible? | Notes |
|----------------|-----------|-------------|-------|
| `CALADRURI` | `schedulingAddresses` | Yes | |
| `CALURI` | `calendars` (`kind: calendar`) | Yes | |
| `FBURL` | `calendars` (`kind: freeBusy`) | Yes | |

### Extended / unknown

| vCard property | JSContact | Notes |
|----------------|-----------|-------|
| Any unknown / X-* | `vCardProps` | jCard tuple `[name, params, type, value]` |
| Parameters on any | `vCardParams` | On converted JSContact object |

---

## JSContact extension properties (RFC 9555)

| JSContact property | Type | vCard reverse |
|--------------------|------|---------------|
| `vCardProps` | `JCardProp[]` | Emit as original vCard properties |
| `vCardParams` | `String[String\|String[]]` | Re-attach params to vCard property |
| `vCardName` | `String` | Preserve source property name (e.g. `impp` vs `socialprofile`) |

### New vCard: JSPROP + JSPTR

| Element | Purpose |
|---------|---------|
| `JSPROP` | JSON-encoded JSContact property value as TEXT |
| `JSPTR` | JSON Pointer to JSContact property (Card-rooted) |

Applied as `PatchObject` **after** standard vCard→JSContact conversion. Invalid patch → reject entirely.

### New vCard parameter: JSCOMPS

Preserves ordered `Name`/`Address` components and separators on reverse conversion. Sets `isOrdered`, `defaultSeparator`, `separator` components. Valid only when positional count matches deduplicated vCard values.

---

## Appendix A — JSContact property reverse index

Full property-path → vCard section mapping (175 rows in RFC 9555 Table 8). Summary by type:

| JSContact type | Properties with vCard rules |
|----------------|----------------------------|
| **Card** | `addresses`, `anniversaries`, `calendars`, `created`, `directories`, `emails`, `keywords`, `kind`, `language`, `links`, `localizations`, `media`, `members`, `name`, `nicknames`, `notes`, `onlineServices`, `organizations`, `personalInfo`, `phones`, `preferredLanguages`, `prodId`, `relatedTo`, `schedulingAddresses`, `speakToAs`, `titles`, `uid`, `updated`, `vCardProps` |
| **Address** | `components`, `contexts`, `coordinates`, `countryCode`, `defaultSeparator`, `full`, `isOrdered`, `phoneticScript`, `phoneticSystem`, `pref`, `timeZone` |
| **AddressComponent** | `kind`, `value`, `phonetic` |
| **Anniversary** | `kind`, `date`, `place` |
| **Author** | `name`, `uri` |
| **Calendar** | `kind`, `uri`, `contexts`, `label`, `mediaType`, `pref` |
| **CryptoKey** | `uri`, `contexts`, `label`, `mediaType`, `pref` |
| **Directory** | `kind`, `uri`, `listAs`, `contexts`, `label`, `mediaType`, `pref` |
| **EmailAddress** | `address`, `contexts`, `label`, `pref` |
| **LanguagePref** | `language`, `contexts`, `pref` |
| **Link** | `kind`, `uri`, `contexts`, `label`, `mediaType`, `pref` |
| **Media** | `kind`, `uri`, `contexts`, `label`, `mediaType`, `pref` |
| **Name** | `components`, `defaultSeparator`, `full`, `isOrdered`, `phoneticScript`, `phoneticSystem`, `sortAs` |
| **NameComponent** | `kind`, `value`, `phonetic` |
| **Nickname** | `name`, `contexts`, `pref` |
| **Note** | `note`, `created`, `author` |
| **OnlineService** | `service`, `uri`, `user`, `contexts`, `label`, `pref` |
| **Organization** | `name`, `units`, `sortAs`, `contexts` |
| **OrgUnit** | `name`, `sortAs` |
| **PartialDate** | `year`, `month`, `day`, `calendarScale` |
| **PersonalInfo** | `kind`, `value`, `level`, `listAs`, `label` |
| **Phone** | `number`, `features`, `contexts`, `label`, `pref` |
| **Pronouns** | `pronouns`, `contexts`, `pref` |
| **Relation** | `relation` |
| **SchedulingAddress** | `uri`, `contexts`, `label`, `pref` |
| **SpeakToAs** | `grammaticalGender`, `pronouns` |
| **Timestamp** | `utc` |
| **Title** | `kind`, `name`, `organizationId` |

---

## Known non-reversible cases

| Scenario | Loss / ambiguity |
|----------|------------------|
| `GENDER` vCard property | No JSContact equivalent; only `vCardProps` or discard |
| `DERIVED=TRUE` properties | MAY skip conversion entirely |
| `GROUP` parameter | Not in JSContact; optional preserve in `vCardParams` |
| `ALTID` | Used for merging; verbatim only in `vCardParams` |
| Multiple `FN` without `LANGUAGE` | Only one → `name.full`; rest → `vCardProps` |
| `MEMBER` `PREF` | Not mapped to JSContact |
| `CATEGORIES` `PREF` | Order not preserved in `keywords` |
| `TEL` default `voice` TYPE | **Implemented:** default vCard voice → `features.voice` on read |
| `GEO`/`TZ` without `ADR` grouping | **Implemented:** merge by matching `GROUP`; ungrouped GEO/TZ attach to first address when grouped ADR exists |
| Legacy ADR 7-component format | Rich components collapsed; `JSCOMPS` needed for round-trip |
| Legacy N 5-component format | `surname2`/`generation` merged into vCard suffix fields |
| `TZ` URI or non-standard UTC-OFFSET | Falls through to `vCardProps` |
| `BIRTHPLACE`/`DEATHPLACE` non-TEXT/non-geo URI | `vCardProps` only |
| DATE month-only or day-only (anniversaries) | No `PartialDate`; §2.15 |
| `TIME`, `DATE-TIME`, `DATE-AND-OR-TIME` values | Property-specific; often §2.15 |
| `X-ABLabel` group names | **Implemented:** `vCardParams.group` preserved on round-trip; standard Home/Work/Mobile/School labels also written outbound with `PROP-ID`+`TYPE` kept |
| `localizations` | **Implemented:** `LANGUAGE` → `localizations` patches; write back localized FN/ADR/NOTE |
| `organizationId` on `Title` | **Implemented:** inferred from grouped `ORG` via `GROUP` param |
| JMAP `id`, `addressBookIds`, `blobId` | Not in vCard; server metadata only |
| Semantic equivalence | RFC 9553 notes URL case, etc. may differ between representations |

---

## Edge cases for implementers

### Anniversary dates

| vCard value type | JSContact `date` |
|----------------|------------------|
| `TIMESTAMP` | `Timestamp.utc` (birth/death); or `PartialDate` for wedding |
| `DATE` (full) | `PartialDate` `{year, month, day}` |
| `DATE` (month or day only) | No standard mapping → `vCardProps` |
| `CALSCALE` param | `PartialDate.calendarScale` |

### FN derivation (JSContact → vCard)

When `name.full` absent: concatenate ordered `components` or use CLDR/heuristic; always set `FN;DERIVED=TRUE` unless using explicit `full`.

### OnlineService disambiguation

Both `IMPP` and `SOCIALPROFILE` map to `OnlineService`. Set `vCardName` on read; use it on write to emit correct property.

### Level mapping (EXPERTISE)

| vCard `LEVEL` | JSContact `PersonalInfo.level` |
|---------------|-------------------------------|
| `beginner` | `low` |
| `average` | `medium` |
| `expert` | `high` |
| other | verbatim, lowercase |

### PHONETIC + LANGUAGE

Phonetic values with `LANGUAGE` → `localizations` patches on `name/components/N/phonetic`, `phoneticSystem`, `phoneticScript`.

### UID stability

Converter SHOULD generate deterministic `uid` when vCard lacks `UID` (implementation-specific).

### Photo / media blobs

vCard `PHOTO` with embedded/base64 → `Media.uri` (`data:`). JMAP may expose `blobId` instead (RFC 9610) — outside RFC 9555 scope.

---

## Quick reference: vCard property coverage checklist

```
BEGIN END KIND SOURCE XML
FN N NICKNAME PHOTO GENDER GRAMGENDER PRONOUNS
BDAY BIRTHPLACE DEATHDATE DEATHPLACE ANNIVERSARY
ADR EMAIL TEL IMPP LANG LANGUAGE SOCIALPROFILE
GEO TZ ORG TITLE ROLE MEMBER RELATED CONTACT-URI LOGO
EXPERTISE HOBBY INTEREST ORG-DIRECTORY
CATEGORIES NOTE PRODID CREATED REV SOUND UID URL VERSION
CLIENTPIDMAP X-ABLabel KEY CALADRURI CALURI FBURL
+ all extended/X-* via vCardProps
```

---

## References

- [RFC 9555 Appendix A](https://www.rfc-editor.org/rfc/rfc9555#appendix-A) — authoritative reverse property index
- [RFC 9982](https://www.rfc-editor.org/info/rfc9982) — JSContact 2.0 + `uid` conversion delta → `rfc9982-conversion-matrix.md`
- [RFC 9554](https://www.rfc-editor.org/info/rfc9554) — `LANGUAGE`, `GRAMGENDER`, `PRONOUNS`, `SOCIALPROFILE`, extended `ADR`/`N`, `PROP-ID`, `PHONETIC`, `SCRIPT`
- Type definitions: `rfc9553-jscontact-types.md`
- JMAP layer: `rfc9610-summary.md`
