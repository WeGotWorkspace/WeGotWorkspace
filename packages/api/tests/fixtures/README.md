# API conversion test fixtures

Curated subsets of upstream interop fixtures for vCard ↔ JSContact and iCalendar ↔ JMAP calendar conversion tests. We do **not** vendor entire upstream repositories.

## Contacts

| Directory | Source | License | Assertion style |
|-----------|--------|---------|-----------------|
| `Contacts/*.vcf` + `*.json` | WGW-authored golden pairs | Project | Strict golden JSON match + round-trip |
| `Contacts/Interop/audriga/` | [audriga/jmap-php-icalendar_vcard](https://github.com/audriga/jmap-php-icalendar_vcard) `tests/resources/` | MIT | Parse + round-trip stability only |

### Audriga subset

Real-world exports from groupware stacks (Horde, Nextcloud, Roundcube, Microsoft Exchange). Filenames match upstream.

## Calendars

| Directory | Source | License | Assertion style |
|-----------|--------|---------|-----------------|
| `Calendars/Fastmail/` | [fastmail/Text-JSCalendar](https://github.com/fastmail/Text-JSCalendar) `testdata/icalendar/` | CPAN (Artistic/GPL) | Key-field golden JSON + ICS round-trip |
| `Calendars/Interop/audriga/` | [audriga/jmap-php-icalendar_vcard](https://github.com/audriga/jmap-php-icalendar_vcard) `tests/resources/` | MIT | Parse + round-trip stability only |

## DKIM

| Directory | Source | License | Assertion style |
|-----------|--------|---------|-----------------|
| `Calendars/Dkim/rfc8463-football.eml` | [RFC 8463](https://www.rfc-editor.org/rfc/rfc8463) Appendix A.3, keys from A.2 | IETF Trust (code components) | Both signatures verify |
| `Calendars/Dkim/reply-*.eml` | WGW-authored iMIP replies signed with [dkimpy](https://launchpad.net/dkimpy) 1.1.8 (RSA 2048 and Ed25519 keys made for this, private keys not kept) | Project | Verify; tampered copies fail |

`dns.json` holds the TXT records the fake resolver serves. The `.eml` files are CRLF byte for byte (`.gitattributes` keeps git from converting them).

## Threads

| Directory | Source | License | Assertion style |
|-----------|--------|---------|-----------------|
| `Threads/*.ics` + `*.json` | WGW-authored: the ICS Chat and Docs stored before #2173 moved them onto the shared thread module, and what they read back | Project | Strict golden bytes (PRODID normalised) + parsed JSON |

The `.ics` files are CRLF byte for byte (`.gitattributes` keeps git from converting them). Regenerate only on purpose, with `WGW_GOLDEN_UPDATE=1`.

## Fastmail normative references

- **Text::JSContact** ([CPAN Text-JSContact](https://metacpan.org/pod/Text::JSContact)) — RFC 9555 figure tests in `t/rfc9555.t` and `t/apple.t`
- **Text::JSCalendar** ([GitHub fastmail/Text-JSCalendar](https://github.com/fastmail/Text-JSCalendar)) — iCalendar golden `.ics` files

WGW keeps its 27 contact golden pairs as primary strict goldens; external fixtures extend coverage per [#160](https://github.com/WeGotWorkspace/wegotworkspace/issues/160) (parent [#137](https://github.com/WeGotWorkspace/wegotworkspace/issues/137)).
