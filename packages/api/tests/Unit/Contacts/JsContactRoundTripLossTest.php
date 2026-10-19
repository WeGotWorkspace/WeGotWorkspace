<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\ConversionSupport;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use App\Services\VObject\VCardInPlacePatcher;
use PHPUnit\Framework\TestCase;

/**
 * Characterization tests for round-trip data loss on ContactCard edits.
 *
 * Each test replays the ContactCard/set and REST PATCH update path
 * (ContactCardRepository::patchWithPrecondition): read the stored vCard into
 * JSContact, deep-merge the client patch, normalize map keys, render, and patch
 * the stored vCard in place. Inputs are what Apple Contacts, Thunderbird and DAVx5 write.
 * The media blob step (ContactMediaBlobResolver) is an identity for inline
 * base64 photos and is not replayed.
 *
 * Tests named `*_survive*`, `*_kept*` or `*_stable*` pin findings that #1418
 * fixed for unrelated edits; read-side gaps are still asserted where they
 * remain. The other tests pin CURRENT (lossy) behavior so the gaps in
 * docs/architecture/jscontact-conformance.md stay provable.
 */
final class JsContactRoundTripLossTest extends TestCase
{
    /** An unrelated edit: the web app adds a note. */
    private const UNRELATED_PATCH = ['notes' => ['wgwnote' => ['@type' => 'Note', 'note' => 'Edited in WGW']]];

    private VCardJsContactConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new VCardJsContactConverter;
    }

    /** CT-1 (fixed by #1419): every ungrouped address is read, and editing one keeps the other. */
    public function test_ct1_all_ungrouped_addresses_are_read_and_survive(): void
    {
        $vcard = $this->vcard('4.0', "FN:Multi Adr\r\nN:Adr;Multi;;;\r\n"
            ."ADR;TYPE=home:;;Home St 1;Amsterdam;;1000 AA;NL\r\n"
            ."ADR;TYPE=work:;;Work St 2;Utrecht;;3500 BB;NL\r\n");

        $addresses = $this->converter->cardFromVCard($vcard)['addresses'];
        $this->assertCount(2, $addresses);

        $out = $this->edit($vcard);
        $this->assertStringContainsString('Home St 1', $out);
        $this->assertStringContainsString('Work St 2', $out);

        $workId = array_key_last($addresses);
        $work = $addresses[$workId];
        foreach ($work['components'] as $i => $component) {
            if (($component['kind'] ?? null) === 'locality') {
                $work['components'][$i]['value'] = 'Rotterdam';
            }
        }
        $edited = $this->edit($vcard, ['addresses' => [$workId => $work]]);
        $this->assertStringContainsString(';;Home St 1;Amsterdam;;1000 AA;NL', $edited);
        $this->assertStringContainsString('Rotterdam', $edited);
        $this->assertStringNotContainsString('Utrecht', $edited);
    }

    /** CT-2 (fixed by #1418): Apple groups and labels stay put across edits; no GROUP= parameter. */
    public function test_ct2_apple_groups_and_labels_survive_two_edits(): void
    {
        $vcard = $this->vcard('3.0', "FN:Els Lab\r\nN:Lab;Els;;;\r\n"
            ."item1.EMAIL;type=INTERNET:els@other.example\r\n"
            ."item1.X-ABLabel:_\$!<Other>!\$_\r\n"
            ."TEL;type=HOME;type=FAX:+31 20 000 0003\r\n");

        $second = $this->edit($this->edit($vcard));
        $this->assertStringContainsStringIgnoringCase("item1.EMAIL;TYPE=INTERNET:els@other.example\r\n", $second);
        $this->assertStringContainsStringIgnoringCase('item1.X-ABLABEL:_$!<Other>!$_', $second);
        $this->assertSame(1, substr_count(strtolower($second), 'item1.x-ablabel'));
        $this->assertStringNotContainsString('GROUP=', $second);
    }

    /** CT-3 (fixed by #1418): labels and groups of item properties WGW does not model survive. */
    public function test_ct3_apple_item_labels_on_unmodelled_properties_survive(): void
    {
        $out = strtolower($this->edit($this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."item1.X-ABRELATEDNAMES;type=pref:Jane Doe\r\n"
            ."item1.X-ABLabel:_\$!<Spouse>!\$_\r\n"
            ."item2.X-ABDATE:2020-01-01\r\n"
            ."item2.X-ABLabel:First met\r\n"
            ."item3.URL;type=pref:https://example.com\r\n"
            ."item3.X-ABLabel:_\$!<HomePage>!\$_\r\n"
            ."item4.ADR;type=HOME:;;Damrak 1;Amsterdam;;1012 LG;Netherlands\r\n"
            ."item4.X-ABADR:nl\r\n")));

        foreach (['item1.x-abrelatednames', 'item1.x-ablabel:_$!<spouse>!$_', 'item2.x-abdate:2020-01-01', 'item2.x-ablabel:first met', 'item3.url', 'item3.x-ablabel:_$!<homepage>!$_', 'item4.x-abadr:nl'] as $kept) {
            $this->assertStringContainsString($kept, $out);
        }
    }

    /** CT-4 (fixed by #1418 and #1421): Apple's year-less birthday is read without a year and stays year-less. */
    public function test_ct4_apple_yearless_birthday_is_read_and_written_without_year(): void
    {
        $vcard = $this->vcard('3.0', "FN:Apple Bday\r\nN:Bday;Apple;;;\r\n"
            ."BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17\r\n");

        $anniversaries = $this->converter->cardFromVCard($vcard)['anniversaries'];
        $id = array_key_first($anniversaries);
        $this->assertSame(['@type' => 'PartialDate', 'month' => 5, 'day' => 17], $anniversaries[$id]['date']);

        $this->assertStringContainsString("BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17\r\n", $this->edit($vcard));

        $moved = $this->edit($vcard, ['anniversaries' => [$id => [
            '@type' => 'Anniversary', 'kind' => 'birth', 'date' => ['@type' => 'PartialDate', 'month' => 6, 'day' => 2],
        ]]]);
        $this->assertMatchesRegularExpression('/BDAY;[^\r]*X-APPLE-OMIT-YEAR=1604[^\r]*:1604-06-02\r\n/i', $moved);
    }

    /** CT-4 (#1421): on vCard 4.0 a year-less birthday is written as --MMDD. */
    public function test_ct4_yearless_birthday_on_vcard4_uses_dash_dash(): void
    {
        $vcard = $this->vcard('4.0', "FN:Bday Four\r\nBDAY;VALUE=date:--0517\r\n");
        $id = array_key_first($this->converter->cardFromVCard($vcard)['anniversaries']);

        $out = $this->edit($vcard, ['anniversaries' => [$id => [
            '@type' => 'Anniversary', 'kind' => 'birth', 'date' => ['@type' => 'PartialDate', 'month' => 6, 'day' => 2],
        ]]]);

        $this->assertStringContainsString(':--0602', $out);
        $this->assertStringNotContainsString('X-APPLE-OMIT-YEAR', $out);
    }

    /**
     * CT-5 (fixed by #1418): unknown values are no longer escaped again on every edit.
     * Sabre re-serializes the stored X-ANDROID-CUSTOM once with escaped semicolons;
     * it is stable after that. That one-time escaping is a separate gap.
     */
    public function test_ct5_unknown_property_values_are_stable_across_edits(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\n"
            ."CLIENTPIDMAP:1;urn:uuid:3df403f4-5924-4bb7-b077-3c711d9eb34b\r\n"
            ."X-MULTI:a,b\r\n"
            ."X-ANDROID-CUSTOM:vnd.android.cursor.item/nickname;Janey;1;;\r\n");

        $first = $this->edit($vcard);
        $second = $this->edit($first);
        $this->assertStringContainsString("CLIENTPIDMAP:1;urn:uuid:3df403f4-5924-4bb7-b077-3c711d9eb34b\r\n", $second);
        $this->assertStringContainsString("X-MULTI:a,b\r\n", $second);
        $this->assertSame(
            substr_count($first, '\\'),
            substr_count($second, '\\'),
            'no extra backslashes on the second edit',
        );
    }

    /** CT-6 (fixed by #1424): vCard 3.0 TYPE=pref is read as pref and written back as TYPE=pref. */
    public function test_ct6_vcard3_type_pref_is_read_and_written(): void
    {
        $vcard = $this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."EMAIL;type=INTERNET;type=WORK:john@work.example\r\n"
            ."EMAIL;type=INTERNET;type=HOME;type=pref:john@home.example\r\n"
            ."TEL;type=CELL;type=VOICE;type=pref:+31 6 1234 5678\r\n");

        $emails = $this->converter->cardFromVCard($vcard)['emails'];
        $prefs = array_column(array_values($emails), 'pref', 'address');
        $this->assertSame(['john@home.example' => 1], $prefs);

        $out = strtolower($this->edit($vcard));
        $this->assertStringContainsString('home,pref:john@home.example', $out);

        $workId = array_search('john@work.example', array_map(static fn (array $e): string => (string) $e['address'], $emails), true);
        $moved = strtolower($this->edit($vcard, ['emails' => [$workId => ['address' => 'john@work.example', 'contexts' => ['work' => true], 'pref' => 1]]]));
        $this->assertSame(1, substr_count($moved, 'john@work.example'));
        $this->assertMatchesRegularExpression('/email;[^\r]*type=work,pref[^\r]*:john@work\.example/', $moved);
        $this->assertStringNotContainsString('pref=1', $moved);
    }

    /** CT-7 (fixed for unrelated edits by #1418): unmodelled parameters on known properties survive. */
    public function test_ct7_unmodelled_parameters_survive_an_edit(): void
    {
        $out = $this->edit($this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."EMAIL;PID=1.1;TYPE=work;X-EVOLUTION-UI-SLOT=1:jd@work.example\r\n"
            ."IMPP;X-SERVICE-TYPE=Facebook;type=HOME:xmpp:john@chat.example\r\n"
            ."PHOTO;ENCODING=b;TYPE=JPEG;X-ABCROP-RECTANGLE=ABClipRect_1&0&0&64&64&abc=:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD\r\n"));

        foreach (['PID=1.1', 'X-EVOLUTION-UI-SLOT=1', 'X-SERVICE-TYPE=Facebook', 'X-ABCROP-RECTANGLE='] as $kept) {
            $this->assertStringContainsString($kept, $out);
        }
    }

    /** CT-8 (fixed for unrelated edits by #1418): value types and schemes of known properties survive. */
    public function test_ct8_known_property_values_survive_an_edit(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."TEL;VALUE=uri;TYPE=\"voice,cell\":tel:+31612345678;ext=12\r\n"
            ."ADR;GEO=\"geo:52.37,4.89\";TYPE=home:;;Damrak 1;Amsterdam;;1012 LG;Netherlands\r\n"
            ."RELATED;TYPE=spouse;VALUE=text:Jane Doe\r\n"));

        $this->assertStringContainsString("TEL;VALUE=uri;TYPE=\"voice,cell\":tel:+31612345678;ext=12\r\n", $out);
        $this->assertStringContainsString('GEO="geo:52.37,4.89"', $out);
        $this->assertStringContainsString("RELATED;TYPE=spouse;VALUE=text:Jane Doe\r\n", $out);
    }

    /** CT-9 (fixed by #1428): each NICKNAME value is its own nickname; an escaped comma stays one. */
    public function test_ct9_nickname_list_is_read_as_separate_nicknames(): void
    {
        $vcard = $this->vcard('3.0', "FN:Al Bundy\r\nN:Bundy;Al;;;\r\nNICKNAME:Al,Ally\r\n");

        $names = array_column(array_values($this->converter->cardFromVCard($vcard)['nicknames']), 'name');
        $this->assertSame(['Al', 'Ally'], $names);
        $this->assertStringContainsString("NICKNAME:Al,Ally\r\n", $this->edit($vcard));

        $escaped = $this->vcard('3.0', "FN:Bob\r\nN:;Bob;;;\r\nNICKNAME:Bob\\,Rob\r\n");
        $this->assertSame(['Bob,Rob'], array_column(array_values($this->converter->cardFromVCard($escaped)['nicknames']), 'name'));
    }

    /** CT-10 (fixed by #1425): changing an entry's context replaces the old context. */
    public function test_ct10_context_change_replaces_old_context(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\nEMAIL;PROP-ID=e1;TYPE=work:jd@example.com\r\n");
        $id = array_key_first($this->converter->cardFromVCard($vcard)['emails']);

        // What the web app sends when the user switches the email from Work to Home (editDraftToPatch).
        $out = $this->edit($vcard, ['emails' => [$id => ['address' => 'jd@example.com', 'contexts' => ['private' => true]]]]);

        $this->assertSame(1, substr_count($out, 'jd@example.com'));
        $this->assertStringContainsString('TYPE=home', $out);
        $this->assertStringNotContainsString('work', $out);
    }

    /** CT-10 (fixed by #1425): a context change keeps the fields the web app does not send, like an Apple label. */
    public function test_ct10_context_change_keeps_the_apple_label(): void
    {
        $vcard = $this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."item1.EMAIL;PROP-ID=e1;TYPE=work:jd@example.com\r\nitem1.X-ABLabel:Newsletter\r\n");
        $id = array_key_first($this->converter->cardFromVCard($vcard)['emails']);

        $out = $this->edit($vcard, ['emails' => [$id => ['address' => 'jd@example.com', 'contexts' => ['private' => true]]]]);
        $this->assertSame(1, substr_count($out, 'jd@example.com'));

        $this->assertStringContainsStringIgnoringCase('item1.X-ABLABEL:Newsletter', $out);
        $this->assertStringContainsStringIgnoringCase('item1.EMAIL', $out);
    }

    /** CT-10 (fixed by #1425): RFC 8620 PatchObject pointer paths are applied. */
    public function test_ct10_patch_object_pointer_paths_are_applied(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\nEMAIL;PROP-ID=e1:a@example.com\r\nEMAIL;PROP-ID=e2:b@example.com\r\n");

        $ids = array_keys($this->converter->cardFromVCard($vcard)['emails']);
        $out = $this->edit($vcard, ['emails/'.$ids[1] => null]);
        $this->assertStringNotContainsString('b@example.com', $out);
        $this->assertStringContainsString('a@example.com', $out);
    }

    /** CT-11 (fixed for unrelated edits by #1418): the ADR LABEL is not copied into an X-ABLabel. */
    public function test_ct11_adr_label_is_not_duplicated_on_edit(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=work;LABEL=\"Acme\\nDamrak 2\":;;Damrak 2;Amsterdam;;1012 LG;NL\r\n"));

        $this->assertStringContainsString('LABEL=Acme\nDamrak 2', $out);
        $this->assertStringNotContainsString('X-ABLABEL', $out);
    }

    /** CT-11 (fixed by #1429): ADR LABEL is read as `full` only, so editing the address adds no X-ABLabel. */
    public function test_ct11_adr_label_is_full_only_and_edit_adds_no_x_ablabel(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=work;LABEL=\"Acme\\nDamrak 2\":;;Damrak 2;Amsterdam;;1012 LG;NL\r\n");
        $addresses = $this->converter->cardFromVCard($vcard)['addresses'];
        $id = array_key_first($addresses);
        $this->assertArrayNotHasKey('label', $addresses[$id]);

        $address = $addresses[$id];
        foreach ($address['components'] as $i => $component) {
            if (($component['kind'] ?? null) === 'locality') {
                $address['components'][$i]['value'] = 'Haarlem';
            }
        }
        $out = $this->edit($vcard, ['addresses' => [$id => $address]]);

        $this->assertStringContainsString('Haarlem', $out);
        $this->assertStringNotContainsString('Acme', $this->onlyXAbLabels($out));
    }

    /** CT-13 (fixed by #1431): a timestamp ANNIVERSARY is read as a Timestamp and keeps its time when edited. */
    public function test_ct13_anniversary_timestamp_is_read_and_kept(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\nANNIVERSARY:20100601T120000Z\r\n");
        $anniversaries = $this->converter->cardFromVCard($vcard)['anniversaries'];
        $id = array_key_first($anniversaries);
        $this->assertSame('Timestamp', $anniversaries[$id]['date']['@type']);

        $anniversaries[$id]['date']['utc'] = '2011-06-01T12:00:00Z';
        $out = $this->edit($vcard, ['anniversaries' => [$id => $anniversaries[$id]]]);

        $this->assertStringContainsString('20110601T120000Z', $out);
    }

    private function onlyXAbLabels(string $vcard): string
    {
        return implode("\n", array_filter(explode("\r\n", $vcard), static fn (string $line): bool => stripos($line, 'X-ABLABEL') !== false));
    }

    /** CT-12 (fixed for unrelated edits by #1418): a card-level TZ stays a property. */
    public function test_ct12_tz_property_survives_an_edit(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=home:;;Damrak 1;Amsterdam;;1012 LG;NL\r\n"
            ."TZ;VALUE=TEXT:Europe/Amsterdam\r\n"));

        $this->assertStringContainsString("TZ;VALUE=TEXT:Europe/Amsterdam\r\n", $out);
        $this->assertStringNotContainsString('TZ=Europe/Amsterdam', $out);
    }

    /** CT-13 (fixed for unrelated edits by #1418): a timestamp ANNIVERSARY keeps its time. */
    public function test_ct13_anniversary_timestamp_survives_an_edit(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\nANNIVERSARY:20100601T120000Z\r\n"));

        $this->assertStringContainsString("ANNIVERSARY:20100601T120000Z\r\n", $out);
    }

    /** #1457: editing an Apple group's members keeps the stored member lines and writes no MEMBER on vCard 3.0. */
    public function test_group_member_edits_keep_stored_member_lines(): void
    {
        $vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\nPRODID:-//Apple Inc.//macOS 26.6.2//EN\r\nN:Family\r\nFN:Family\r\n"
            ."X-ADDRESSBOOKSERVER-KIND:group\r\n"
            ."X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:A1111111-1111-4111-8111-111111111111\r\n"
            ."X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:A2222222-2222-4222-8222-222222222222\r\n"
            ."UID:B3333333-3333-4333-8333-333333333333\r\nEND:VCARD\r\n";
        $members = $this->converter->cardFromVCard($vcard)['members'];

        $added = $this->edit($vcard, ['members' => $members + ['urn:uuid:a4444444-4444-4444-8444-444444444444' => true]]);
        $this->assertStringContainsString("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:A1111111-1111-4111-8111-111111111111\r\n", $added);
        $this->assertStringContainsString("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:A2222222-2222-4222-8222-222222222222\r\n", $added);
        $this->assertSame(1, substr_count(strtolower($added), 'a4444444-4444-4444-8444-444444444444'));
        $this->assertStringNotContainsString("\r\nMEMBER:", $added);

        $removed = $this->edit($vcard, ['members' => ['urn:uuid:a2222222-2222-4222-8222-222222222222' => null]]);
        $this->assertStringContainsString("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:A1111111-1111-4111-8111-111111111111\r\n", $removed);
        $this->assertStringNotContainsStringIgnoringCase('a2222222', $removed);
    }

    private function vcard(string $version, string $body): string
    {
        return "BEGIN:VCARD\r\nVERSION:".$version."\r\nUID:urn:uuid:5e1f3a2b-1111-4222-8333-444455556666\r\n"
            .$body."END:VCARD\r\n";
    }

    /**
     * Mirrors ContactCardRepository::patchWithPrecondition + ContactCardMapper::toVCard.
     *
     * @param  array<string, mixed>  $patch
     */
    private function edit(string $vcard, array $patch = self::UNRELATED_PATCH): string
    {
        $existing = $this->converter->cardFromVCard($vcard, 'debug');
        $merged = ConversionSupport::normalizeCardMapKeys(
            ConversionSupport::deepMergeContactCardPatch($existing, $patch),
            $existing,
        );
        $baseline = ConversionSupport::normalizeCardMapKeys($existing, $existing);

        return $this->unfold(VCardInPlacePatcher::patch(
            $vcard,
            $this->converter->vCardFromCard(ConversionSupport::syncGroupDisplayName($baseline)),
            $this->converter->vCardFromCard(ConversionSupport::syncGroupDisplayName($merged)),
        ));
    }

    private function unfold(string $vcard): string
    {
        return str_replace("\r\n ", '', $vcard);
    }
}
