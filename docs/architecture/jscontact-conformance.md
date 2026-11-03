# JSContact (RFC 9553 / RFC 9555) conformance and round-trip audit

Audit of how WeGotWorkspace maps CardDAV vCard (RFC 6350 4.0 and RFC 2426 3.0) to the JSContact Card objects served over JMAP (`urn:ietf:params:jmap:contacts`, RFC 9610) and REST, and back. Date: 2026-10-18. Target specs: [RFC 9553](https://www.rfc-editor.org/rfc/rfc9553) (JSContact), [RFC 9555](https://www.rfc-editor.org/rfc/rfc9555) (vCard conversion), [RFC 9554](https://www.rfc-editor.org/rfc/rfc9554) (vCard extensions).

**Scope:** `packages/api/app/Services/Contacts/Conversion/*`, `ContactCardMapper`, `ContactCardRepository::update` / `patchWithPrecondition`, `ContactCardSetService`, the ContactCard JMAP methods (`app/Services/Jmap/Methods/ContactCard*`), and the web app's edit patch builder (`packages/apps/src/contacts-core/src/contacts-edit-utils.ts`).

**Related:** [jscalendar-conformance.md](jscalendar-conformance.md) (same audit for events and tasks), [packages/api/docs/contacts/rfc9555-conversion-matrix.md](../../packages/api/docs/contacts/rfc9555-conversion-matrix.md) (field mapping reference), [packages/api/docs/contacts/rfc9553-jscontact-types.md](../../packages/api/docs/contacts/rfc9553-jscontact-types.md) (type inventory).

**Evidence:** every round-trip claim below has a test.

- `packages/api/tests/Unit/Contacts/JsContactRoundTripLossTest.php` (CT-1 … CT-13)

These are **characterization tests**. They pass today and assert the current lossy output. The fix for a finding flips that finding's assertions.

---

## Summary

1. **Same root cause as calendars: the writer rebuilds, it doesn't patch.** Every WGW edit (web app, REST `PATCH`/`PUT`, MCP, JMAP `ContactCard/set`) reads the stored vCard into JSContact, merges the patch, and serializes a brand-new vCard from the JSContact object (`ContactCardRepository::patchWithPrecondition` → `ContactCardMapper::toVCard` → `JsContactToVCardConverter::convert`). Even an empty patch rewrites the whole card. `NoteJournalConverter::mergeIntoIcs` and `PropIdEnsurer` (CardDAV PUT) already show the in-place pattern.
2. **The escape hatch is better than `icsProps`, but not lossless.** Unknown properties go to RFC 9555 `vCardProps` as jCard tuples, so their parameters and repeated instances survive. The tuple drops the property **group** (`item1.`), and the value is escaped again on every write (CT-3, CT-5). Parameters on **known** properties are only kept for TYPE, PREF, LABEL and the group; everything else is dropped (CT-7).
3. **Apple's `itemN` label model breaks.** Apple Contacts and DAVx5 (vCard 3.0) attach custom labels with `itemN.X-ABLabel`. WGW keeps labels only for EMAIL/TEL/ADR, writes its own lowercase `itemN` groups that collide with the client's (CT-2), and drops labels on everything else: related names, custom dates, URLs (CT-3).
4. **Some losses happen on read, not only on write.** Multiple ungrouped addresses collapse to the last one (CT-1), vCard 3.0 `type=pref` is ignored (CT-6) and multi-value NICKNAME collapses (CT-9). These are wrong in the WGW UI even before anyone edits, and become permanent on the first edit.
5. **Corruption, not just loss:** a year-less Apple birthday becomes a 1604 birthday (CT-4), unknown values grow a backslash on every edit (CT-5), `tel:` URIs and the ADR `GEO` parameter are rewritten into invalid values (CT-8), and labels jump between properties after two edits (CT-2).
6. **What is good:** PRODID is kept (unlike calendars), SORT-AS, CC, MEDIATYPE, LEVEL, unknown X-properties with parameters, repeated X-properties, inline base64 photos, Apple group cards and localizations round-trip. The web app sends sparse patches with `null` removals, so the calendar RT-10 problem (removed entries come back) does not exist for contacts.

**A items (silent data loss, must fix):** CT-1 … CT-13. See [Classification](#classification).

---

## 1. Property matrix

Legend: ✅ supported · ⚠️ partial or lossy · ❌ not supported · R = vCard → JSContact · W = JSContact → vCard. "vCardProps" means the vCard property survives only as a `vCardProps` jCard tuple (params and repeats kept, group lost, value re-escaped; see CT-3, CT-5).

Code locations (all under `packages/api/app/Services/Contacts/Conversion/`):

- Reader = `VCardToJsContactConverter.php` + `VCardToJsContactCoreFields.php` + `VCardToJsContactExtraFields.php`
- Writer = `JsContactToVCardConverter.php`
- Shared = `ConversionSupport.php` (facade over `ConversionIdMethods`, `ConversionPropertyMethods`, `ConversionUidNameMethods`), `JscopmsSupport.php`, `LocalizationSupport.php`

### 1.1 Card properties (RFC 9553 §2)

| Property | § | R | W | vCard | Notes / code |
|---|---|---|---|---|---|
| `@type`, `version` | 2.1.1–2 | ✅ | ✅ | VERSION | Output VERSION follows the stored VERSION (`versionFromCard`), default 4.0 |
| `created` | 2.1.3 | ✅ | ✅ | CREATED | |
| `kind` | 2.1.4 | ✅ | ✅ | KIND, X-ADDRESSBOOKSERVER-KIND, X-ABShowAs | Apple group and company cards recognised; writer emits both forms |
| `language` | 2.1.5 | ✅ | ✅ | LANGUAGE | |
| `members` | 2.1.6 | ✅ | ✅ | MEMBER, X-ADDRESSBOOKSERVER-MEMBER | Writer emits both forms. Member uids are lowercased (B). |
| `prodId` | 2.1.7 | ✅ | ✅ | PRODID | Original PRODID kept |
| `relatedTo` | 2.1.8 | ✅ | ⚠️ | RELATED | Free-text RELATED loses `VALUE=text` (CT-8) |
| `uid` | 2.1.9 | ✅ | ✅ | UID | |
| `updated` | 2.1.10 | ✅ | ⚠️ | REV | Overwritten from the DB `lastmodified` of the previous write, so REV is never "now" (B) |
| `name` | 2.2.1 | ✅ | ✅ | N, FN | `sortAs` ↔ SORT-AS ✅. `phoneticSystem`/`phoneticScript` ❌ (Apple `X-PHONETIC-*` survive in vCardProps). vCard 3.0 cards get a 7-part N (B). |
| `nicknames` | 2.2.2 | ⚠️ | ✅ | NICKNAME | Multi-value NICKNAME collapses into one (CT-9) |
| `organizations` | 2.2.3 | ✅ | ✅ | ORG | `units`, `sortAs` ✅ |
| `speakToAs` | 2.2.4 | ✅ | ✅ | GRAMGENDER, PRONOUNS | GENDER is preserve-only (vCardProps) |
| `titles` | 2.2.5 | ✅ | ✅ | TITLE, ROLE | |
| `emails` | 2.3.1 | ⚠️ | ⚠️ | EMAIL | 3.0 `type=pref` ignored (CT-6). Params other than TYPE/PREF/LABEL dropped (CT-7). |
| `onlineServices` | 2.3.2 | ⚠️ | ⚠️ | IMPP, SOCIALPROFILE, X-SOCIALPROFILE | Apple `X-SERVICE-TYPE` dropped (CT-7). `X-SOCIALPROFILE` is not mapped (vCardProps). |
| `phones` | 2.3.3 | ⚠️ | ⚠️ | TEL | `VALUE=uri` dropped and `tel:` URI escaped as text (CT-8). 3.0 `type=pref` ignored (CT-6). |
| `preferredLanguages` | 2.3.4 | ✅ | ✅ | LANG | |
| `calendars` | 2.4.1 | ✅ | ✅ | CALURI, FBURL | |
| `schedulingAddresses` | 2.4.2 | ✅ | ✅ | CALADRURI | |
| `addresses` | 2.5.1 | ⚠️ | ⚠️ | ADR, GEO, TZ | Only the last ungrouped ADR survives (CT-1). `coordinates` loses `geo:` on write (CT-8). LABEL is written twice (CT-11). Card-level TZ moves into an ADR parameter (CT-12). |
| `cryptoKeys` | 2.6.1 | ✅ | ✅ | KEY | |
| `directories` | 2.6.2 | ✅ | ✅ | ORG-DIRECTORY, SOURCE | |
| `links` | 2.6.3 | ⚠️ | ⚠️ | URL, CONTACT-URI | Apple `itemN.URL` label dropped (CT-3) |
| `media` | 2.6.4 | ⚠️ | ⚠️ | PHOTO, LOGO, SOUND | Inline base64 and URI photos round-trip (via blobs on the real path). Apple `X-ABCROP-RECTANGLE` dropped (CT-7). |
| `localizations` | 2.7.1 | ⚠️ | ⚠️ | LANGUAGE param | FN/name localizations only (`LocalizationSupport`). ALTID not mapped. |
| `anniversaries` | 2.8.1 | ⚠️ | ⚠️ | BDAY, ANNIVERSARY, DEATHDATE, BIRTHPLACE, DEATHPLACE | Apple `X-APPLE-OMIT-YEAR` dropped (CT-4). Timestamp time dropped (CT-13). Apple `X-ABDATE` not mapped (CT-3). |
| `keywords` | 2.8.2 | ✅ | ✅ | CATEGORIES | Repeated CATEGORIES merge into one (same set; fine) |
| `notes` | 2.8.3 | ✅ | ✅ | NOTE | AUTHOR/CREATED params mapped |
| `personalInfo` | 2.8.4 | ✅ | ✅ | EXPERTISE, HOBBY, INTEREST | LEVEL, INDEX ✅ |
| `vCardProps` | RFC 9555 §2.15.1 | ⚠️ | ⚠️ | unknown properties | Params and repeats kept. Group lost (CT-3). Values re-escaped (CT-5). |
| `vCardParams` | RFC 9555 §2.15.2 | ⚠️ | ⚠️ | unknown params on known properties | Only `group` is stored here. PID, ALTID, X-* params are dropped (CT-7). The group is also written back as a bogus `GROUP=` parameter (CT-2). |
| `vCardName` | RFC 9555 §2.15.3 | ✅ | ✅ | IMPP vs SOCIALPROFILE | |
| `JSPROP` / `JSPTR` | RFC 9555 §3.3 | ❌ | ❌ | | Unknown JSContact properties are dropped on write instead of becoming JSPROP (C) |

### 1.2 Client vendor extensions

| vCard | Client | R | W | Notes |
|---|---|---|---|---|
| `itemN.X-ABLabel` on EMAIL/TEL/ADR | Apple, DAVx5 3.0 | ⚠️ | ⚠️ | Read into `label`. Writer generates `itemN` groups that collide with existing ones (CT-2). Apple standard labels (`_$!<Other>!$_`) are kept raw, not decoded (B). |
| `itemN.X-ABLabel` on URL, X-ABDATE, X-ABRELATEDNAMES, X-ABADR | Apple, DAVx5 3.0 | ❌ | ❌ | Label and group lost (CT-3) |
| `X-ABRELATEDNAMES` | Apple, DAVx5 3.0 | ❌ | ❌ | vCardProps; not mapped to `relatedTo` (B) |
| `X-ABDATE` | Apple, DAVx5 3.0 | ❌ | ❌ | vCardProps; not mapped to `anniversaries` (B) |
| `X-APPLE-OMIT-YEAR` on BDAY/X-ABDATE | Apple | ❌ | ❌ | Dropped on BDAY (CT-4); kept on X-ABDATE (vCardProps) |
| `X-ABCROP-RECTANGLE` on PHOTO | Apple | ❌ | ❌ | CT-7 |
| `X-SERVICE-TYPE` on IMPP | Apple | ❌ | ❌ | CT-7 |
| `X-PHONETIC-FIRST-NAME`/`-LAST-NAME` | Apple, DAVx5 | ❌ | ✅ | vCardProps only (B: `name.phonetic*`) |
| `X-ABUID`, `X-ACTIVITY-ALERT`, `X-ANDROID-CUSTOM`, `X-CUSTOMn` | Apple, DAVx5, Thunderbird | ✅ | ⚠️ | vCardProps. Values with `,` `;` `\` are re-escaped each write (CT-5). |
| `PID` + `CLIENTPIDMAP` | vCard 4.0 sync clients | ❌ | ❌ | PID dropped (CT-7), CLIENTPIDMAP value corrupted (CT-5) |

### 1.3 JMAP protocol

| Requirement | Status |
|---|---|
| RFC 8620 §5.3 PatchObject (`"emails/e2": null`) on `ContactCard/set` update | ❌ Pointer keys are ignored (CT-10) |
| Setting a property replaces it | ⚠️ Id-keyed maps merge by entry id with `null` removal (WGW contract, used correctly by the web app). Inside an entry, nested maps (`contexts`, `features`) are merged, not replaced (CT-10). |
| Top-level `ifInState` | ✅ `ContactCardSetMethod::guardIfInState`, per-entry `ifInState` in `ContactCardSetService` |

---

## 2. Round-trip findings

Every finding replays the real update path: read the stored vCard, deep-merge a patch (usually an unrelated note), normalize map keys, write. Inputs are what Apple Contacts (vCard 3.0), Thunderbird (vCard 4.0) and DAVx5 (vCard 3.0 via ez-vcard) write.

| ID | Finding | Real-world trigger | Test |
|---|---|---|---|
| **CT-1** | **Only the last ungrouped address survives.** `VCardToJsContactCoreFields::convertAddresses` buckets ADR by group; all ungrouped ADRs share the `''` bucket and overwrite each other. The UI shows one address and the first WGW edit deletes the others from storage. Also affects `exportVcard`. | Thunderbird, DAVx5 (home + work address), Google/Outlook imports | `test_ct1_*` |
| **CT-2** | **Apple item groups collide and labels move.** The writer numbers its own groups `item1…` while keeping the client's groups (read back uppercase as `ITEM1…`). vCard groups are case-insensitive, so two labels land in one group. After a second edit the email's "Other" label becomes "Home". The kept group is also written as a bogus `GROUP=ITEM1` parameter. | Any Apple or DAVx5 card with a custom label plus a typed phone/email | `test_ct2_*` |
| **CT-3** | **Labels on unmodelled item properties are lost.** `X-ABLabel` is treated as known, so it never reaches vCardProps; the vCardProps tuple drops the group. Related names lose "Spouse"/"Mother", custom dates lose their label, `X-ABADR` is detached from its address, and an Apple URL loses "HomePage". | Apple "related name", "date", URL fields; DAVx5 3.0 events/relations | `test_ct3_*` |
| **CT-4** | **Year-less birthdays get year 1604.** Apple stores "no year" as `BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17`. The parameter is dropped, so Apple then shows the year 1604 (age 422). | Every Apple contact with a birthday without a year | `test_ct4_*` |
| **CT-5** | **Unknown values gain a backslash on every edit.** vCardProps stores the raw (escaped) value and the writer escapes it again. `X-MULTI:a,b` → `a\,b` → `a\\\,b`. `CLIENTPIDMAP:1;urn…` → `1,urn…` → `1\,urn…`. `X-ANDROID-CUSTOM` and `X-ACTIVITY-ALERT` break the same way. | DAVx5 custom fields, Apple ringtones, vCard 4.0 sync clients | `test_ct5_*` |
| **CT-6** | **vCard 3.0 `type=pref` is ignored.** `prefFromProperty` only reads the 4.0 `PREF` parameter. The preferred email, phone, address and URL are lost on read and on write. | Apple, DAVx5 3.0 (default email / phone) | `test_ct6_*` |
| **CT-7** | **Unmodelled parameters on known properties are dropped.** Only TYPE, PREF, LABEL and the group are kept. Lost: `PID`, `ALTID`, Apple `X-SERVICE-TYPE` (IMPP shows the wrong service), `X-ABCROP-RECTANGLE` (photo crop), Evolution `X-EVOLUTION-*`. RFC 9555 §2.15.2 puts these in `vCardParams`. | Apple IM and photo crop, vCard 4.0 PID sync, Evolution | `test_ct7_*` |
| **CT-8** | **Known values are rewritten into invalid ones.** `TEL;VALUE=uri:tel:…;ext=12` is written as text `tel:…\;ext=12`. `ADR;GEO="geo:52.37,4.89"` is written as `GEO="52.37,4.89"` (no URI). `RELATED;VALUE=text:Jane Doe` loses `VALUE=text`, making "Jane Doe" an invalid URI. | Thunderbird/Evolution vCard 4.0, RFC 6350 sample cards | `test_ct8_*` |
| **CT-9** | **Multi-value NICKNAME collapses.** `NICKNAME:Al,Ally` is read as one nickname and written as `Al\,Ally`. | Apple, Google exports | `test_ct9_*` |
| **CT-10** | **Context changes don't stick; PatchObject ignored.** The web app sends `{address, contexts: {private: true}}` when switching an email from Work to Home. `deepMergeContactCardPatch` merges the `contexts` map, so the result is `TYPE=home,work` and the UI still shows Work. RFC 8620 pointer paths (`emails/e2: null`) are ignored. | Changing an email/phone/address/URL type in the web app | `test_ct10_*` (2) |
| **CT-11** | **ADR LABEL is written twice.** LABEL is read into both `full` and the custom `label`; the writer emits LABEL and an `itemN.X-ABLABEL` holding the whole address with double-escaped newlines. Apple then shows the address text as the address's label. | vCard 4.0 cards with a delivery label | `test_ct11_*` |
| **CT-12** | **Card-level TZ moves into an address.** A TZ property is merged into the first address (`Address.timeZone`) and written back as `ADR;TZ=…`. The TZ property disappears for clients that read it. Conformant with RFC 9555, but lossy for vCard clients. | Thunderbird, Evolution | `test_ct12_*` |
| **CT-13** | **ANNIVERSARY timestamp loses its time.** `ANNIVERSARY:20100601T120000Z` becomes `VALUE=DATE:20100601`. | Rare | `test_ct13_*` |

### What does survive

Pinned by existing tests (`VCardJsContactConverterTest`, `VCardAudrigaInteropTest`, `ContactsIssueGapTest`, `VCardRfc9555FigureGapTest`) or confirmed while probing:

- UID, VERSION, PRODID, KIND (incl. Apple group/company), FN, N incl. SORT-AS, ORG incl. units and SORT-AS, TITLE, ROLE, NOTE with escapes, CATEGORIES, GENDER, SOURCE, EXPERTISE;LEVEL, RELATED URIs.
- EMAIL/TEL/ADR values with TYPE home/work/cell/fax, vCard 4.0 PREF, ADR CC, PHOTO inline base64 and PHOTO URI with MEDIATYPE.
- Apple group cards (`X-ADDRESSBOOKSERVER-MEMBER`), FN localizations, JSCOMPS name/address ordering.
- Unknown X-properties with parameters and repeated instances, as long as the value has no `,` `;` `\` and the property has no group (`X-FOO;X-PARAM=1:val`, `X-SOCIALPROFILE;TYPE=twitter;X-USER=…`, two `X-ABDATE`).
- CardDAV writes themselves: a CardDAV PUT stores the client bytes (plus PROP-ID via `PropIdEnsuringPlugin`). Loss starts at the first WGW edit, or on read for CT-1, CT-6 and CT-9.

Harmless normalizations (not findings): 3.0 `TYPE=INTERNET` and `TYPE=VOICE` are dropped; repeated CATEGORIES are merged into one property.

---

## Classification

### A — silent data loss on round-trip (must fix)

| ID | Short name | Severity |
|---|---|---|
| CT-1 [#1419](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1419) | Only the last ungrouped ADR survives | High (addresses deleted) |
| CT-2 [#1420](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1420) | Apple item groups collide; labels move | High (user-visible corruption, compounds) |
| CT-4 [#1421](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1421) | Year-less birthday becomes 1604 | High (very common on iPhone) |
| CT-5 [#1422](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1422) | Unknown values re-escaped on every edit | High (compounds; breaks CLIENTPIDMAP) |
| CT-3 [#1423](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1423) | Labels on related names, dates, URLs lost | Medium–High |
| CT-6 [#1424](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1424) | vCard 3.0 `type=pref` ignored | Medium (default email/phone lost) |
| CT-10 [#1425](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1425) | Context change merges instead of replaces; PatchObject ignored | Medium (edit silently not applied) |
| CT-7 [#1426](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1426) | Unmodelled params on known properties dropped | Medium (fixed structurally by A0) |
| CT-8 [#1427](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1427) | `tel:` URI, GEO param, RELATED text corrupted | Medium (invalid vCard) |
| CT-9 [#1428](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1428) | Multi-value NICKNAME collapses | Low–Medium |
| CT-11 [#1429](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1429) | ADR LABEL duplicated into X-ABLabel | Low–Medium |
| CT-12 [#1430](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1430) | TZ moved into an ADR parameter | Low |
| CT-13 [#1431](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1431) | ANNIVERSARY time dropped | Low |

### B — properties UI, MCP or clients plausibly need (fix on demand)

| Item | Why |
|---|---|
| Map `X-ABRELATEDNAMES` → `relatedTo` and `X-ABDATE` → `anniversaries` (with label) | Apple/DAVx5 3.0 relations and dates show up in WGW; carries CT-3 data in JSON |
| Decode Apple standard labels (`_$!<Other>!$_`, `_$!<HomePage>!$_`) on read, and write standard contexts as TYPE only instead of literal `X-ABLabel:Home` | WGW currently writes "Home"/"Work"/"Mobile" as custom labels into every card, including Thunderbird 4.0 cards |
| `name.phoneticSystem`/component `phonetic` ↔ `X-PHONETIC-*` and RFC 9554 PHONETIC | Japanese/Chinese name sorting in the UI |
| `OnlineService.service` from Apple `X-SERVICE-TYPE`; `X-SOCIALPROFILE` → `onlineServices` | Shows the right service icon |
| Bump REV on WGW edits | Clients that order or merge by REV. `ContactCardMapper::toContactCard` overwrites `updated` with the previous DB `lastmodified`, which the writer emits as REV. |
| Keep member uid case (`normalizeMemberUid` lowercases `urn:uuid:5E1F…`) | Apple uses uppercase UIDs. Verify on device whether Apple matches group members case-sensitively. |
| Write a 5-part N for vCard 3.0 cards | 3.0 defines 5 N components; WGW writes 7 (RFC 9554). Verify older clients. |
| `ALTID` → `localizations` beyond FN/N | Multi-language cards |

### C — unused corners of the spec (document as intentionally unsupported)

`JSPROP`/`JSPTR` for unknown JSContact properties, PHONETIC/SCRIPT parameters beyond B, `localizations` PatchObjects for non-name properties, Card `version: "2.0"` features (RFC 9982 beyond `uid`), `Resource.label` on media, `CalendarScale` other than gregorian, `PartialDate.calendarScale`. With A0 in place these all survive a CardDAV round-trip as opaque vCard, even though JMAP never exposes them.

---

## Filed

Tracked in milestone [CardDAV interop hardening](https://github.com/WeGotWorkspace/WeGotWorkspace/milestone/12): Goal [Product#139](https://github.com/WeGotWorkspace/Product/issues/139), Epic #1417, A0-C #1418. Spec-conformance Tasks B-C1–B-C3: #1432–#1434 (no milestone). Contacts got their own milestone and Goal instead of joining the calendar one.

The drafts below are what was filed.

## Proposed milestone: `CalDAV/CardDAV interop hardening`

These items join the milestone proposed in [jscalendar-conformance.md](jscalendar-conformance.md#proposed-milestone-calendar-interop-hardening). Follows [issue-filing.md](../../.agents/skills/developer/issue-filing.md).

- **Goal:** extend the calendar Goal to cover contacts, or file a sibling Goal (Product Project, Status **Identified**).
- **A items** are **Bugs** (`bug-report.yml`, GitHub type Bug, no Goal required). They carry the milestone and link to the Goal in *Additional context*.
- **Selected B items** are **Tasks** (`type:task`, parent = the Goal).
- Labels: `area:contacts`.

**A0-C is the structural fix.** It removes CT-2, CT-3, CT-5, CT-7, CT-8, CT-11 and CT-12 at once for unrelated edits. CT-1, CT-4, CT-6, CT-9 and CT-10 are read or merge bugs and need their own fix either way. Per-finding Bugs stay so each loss has its own failing-to-passing test.

### Goal addition — Edit contacts in WeGotWorkspace without breaking them on phones and desktop apps

- **Outcome:** A contact created in Apple Contacts, Thunderbird or an Android CardDAV app keeps all its details (all addresses, labels, related names, birthdays without a year, preferred email, custom fields) after someone edits it in WeGotWorkspace.
- **Who:** People who sync WGW contacts to their phone or desktop address book.
- **Success looks like:** Editing one field of any contact in WGW changes only that field as seen from every other client.
- **Non-goals:** Exposing every vCard extension in the WGW UI.

### A0-C (Task, parent Goal) — Update stored vCards in place instead of rebuilding them

**Body:** Contact updates serialize a new vCard from the JSContact object, so everything the model can't represent is dropped or rewritten. Change `ContactCardRepository::update`/`patchWithPrecondition` (and `moveCardToAddressBook`) to patch the stored vCard. Regenerate only the properties whose JSContact value changed (matched by PROP-ID, which `PropIdEnsuringPlugin` already guarantees), and keep every other property, parameter, group and `itemN.X-ABLabel` byte-identical. `NoteJournalConverter::mergeIntoIcs` and `PropIdEnsurer` are the in-repo patterns.

- [ ] An unrelated edit leaves all other vCard lines byte-identical, including groups, parameters and repeated instances
- [ ] Changed entries keep their group, X-ABLabel and unmodelled parameters
- [ ] New entries get a group name that does not collide (case-insensitive) with existing groups
- [ ] `exportVcard` serves the stored bytes, or the same in-place result
- [ ] `JsContactRoundTripLossTest` CT-2, CT-3, CT-5, CT-7, CT-8, CT-11, CT-12 assertions flipped to "preserved"
- [ ] Audriga interop fixtures and `VCardJsContactConverterTest` still pass

### A-bugs

Format: **Title** · What is going wrong · What should happen · Acceptance criteria.

**CT-1 — Contacts with several addresses keep only the last one**
- Wrong: Ungrouped ADR properties overwrite each other in `convertAddresses`; WGW shows one address and the next edit deletes the rest.
- Expected: Every ADR becomes its own `addresses` entry. GEO/TZ are only merged when unambiguous.
- AC:
  - [ ] Two and three ungrouped ADRs all read and round-trip
  - [ ] GEO/TZ merge only into a single ungrouped ADR
  - [ ] `test_ct1_*` flipped

**CT-2 — Contact labels move to other fields after editing in WGW**
- Wrong: WGW-generated `itemN` groups collide with the client's `ITEMN` groups; the group is also written as a `GROUP=` parameter.
- Expected: Existing groups are kept; new groups never collide (case-insensitive); no `GROUP` parameter in vCard text.
- AC:
  - [ ] Two consecutive edits keep every label on its original property
  - [ ] No `GROUP=` parameter in output
  - [ ] `test_ct2_*` flipped

**CT-3 — Related names, custom dates and website labels lose their labels**
- Wrong: `itemN.X-ABLabel` is dropped for properties WGW does not model, and vCardProps loses the group.
- Expected: Group and label survive (A0-C); vCardProps tuples carry the group (RFC 9555 jCard `group` param).
- AC:
  - [ ] X-ABRELATEDNAMES, X-ABDATE, URL and X-ABADR keep their `itemN` group and label
  - [ ] `test_ct3_*` flipped

**CT-4 — Birthdays without a year show year 1604 after an edit**
- Wrong: `X-APPLE-OMIT-YEAR` is dropped, so the placeholder year becomes real.
- Expected: Read as a PartialDate without `year`; write back with `X-APPLE-OMIT-YEAR=1604` for vCard 3.0 (and `--MMDD` for 4.0).
- AC:
  - [ ] `anniversaries` has no `year` for an Apple year-less birthday
  - [ ] The written BDAY keeps `X-APPLE-OMIT-YEAR=1604`
  - [ ] Same for X-ABDATE when mapped (B)
  - [ ] `test_ct4_*` flipped

**CT-5 — Custom contact fields gain backslashes on every edit**
- Wrong: vCardProps values are escaped again on write.
- Expected: Unknown and preserve-only properties are written with their original raw value; structured values (CLIENTPIDMAP) keep their structure.
- AC:
  - [ ] Ten consecutive edits leave `X-MULTI:a,b`, `CLIENTPIDMAP:1;urn:…` and `X-ANDROID-CUSTOM` unchanged
  - [ ] `test_ct5_*` flipped

**CT-6 — The preferred email and phone from iPhone/Android are lost**
- Wrong: vCard 3.0 `TYPE=pref` is ignored.
- Expected: `TYPE=pref` reads as `pref: 1`; on a 3.0 card `pref` is written as `TYPE=pref`.
- AC:
  - [ ] Read and write for EMAIL, TEL, ADR, URL, IMPP
  - [ ] `test_ct6_*` flipped

**CT-7 — Contact fields lose extra parameters (IM service, photo crop, PID) on edit**
- Wrong: Only TYPE, PREF and LABEL are kept on known properties.
- Expected: Unmodelled parameters survive (A0-C) and are exposed as `vCardParams` per RFC 9555 §2.15.2.
- AC:
  - [ ] PID, ALTID, X-SERVICE-TYPE, X-ABCROP-RECTANGLE and X-* params survive an unrelated edit
  - [ ] `test_ct7_*` flipped

**CT-8 — Editing a contact writes invalid phone URIs and coordinates**
- AC:
  - [ ] `TEL;VALUE=uri` keeps VALUE=uri and its unescaped `tel:` URI
  - [ ] ADR `GEO` parameter keeps its `geo:` scheme
  - [ ] Free-text RELATED keeps `VALUE=text`
  - [ ] `test_ct8_*` flipped

**CT-9 — Several nicknames collapse into one**
- AC:
  - [ ] Each comma-separated NICKNAME value becomes its own `nicknames` entry, or the property keeps its list value
  - [ ] `test_ct9_*` flipped

**CT-10 — Changing an email, phone or address type in the web app doesn't stick**
- Wrong: `deepMergeContactCardPatch` merges nested maps inside an entry (`contexts`, `features`); RFC 8620 pointer paths are ignored.
- Expected: A value for `contexts`/`features` replaces the old map; `a/b` pointer keys patch nested values per RFC 8620 §5.3.
- AC:
  - [ ] Work → Home on an email results in `TYPE=home` only
  - [ ] PatchObject pointer paths applied, with `invalidPatch` on bad paths
  - [ ] `test_ct10_*` flipped

**CT-11 — An address's delivery label becomes its display label**
- AC:
  - [ ] ADR LABEL maps to `full` only, not to `label`
  - [ ] No X-ABLabel is synthesized from `full`
  - [ ] `test_ct11_*` flipped

**CT-12 — A contact's time zone moves into its address**
- AC:
  - [ ] An ungrouped TZ property is written back as TZ (A0-C keeps it verbatim)
  - [ ] `test_ct12_*` flipped

**CT-13 — Anniversary time is dropped**
- AC:
  - [ ] Timestamp ANNIVERSARY reads as `Timestamp` and writes back with its time
  - [ ] `test_ct13_*` flipped

### Selected B Tasks (parent: Goal)

**B-C1 — Map Apple related names and dates**
- AC:
  - [ ] `X-ABRELATEDNAMES` ↔ `relatedTo` (relation from the decoded label)
  - [ ] `X-ABDATE` ↔ `anniversaries` (kind from the decoded label, custom label kept)
  - [ ] Web app shows both

**B-C2 — Decode Apple standard labels and stop writing literal "Home/Work/Mobile" labels**
- AC:
  - [ ] `_$!<…>!$_` labels decoded to contexts/kinds on read and re-encoded on write
  - [ ] Thunderbird 4.0 cards get no X-ABLabel lines from WGW

**B-C3 — Bump REV on WGW edits**
- AC:
  - [ ] REV equals the write time after an edit
  - [ ] `updated` matches REV in the response

Other B items (phonetic names, `X-SERVICE-TYPE` as `service`, member uid case, 5-part N for 3.0, ALTID) can be filed when a consumer needs them.
