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

    /** CT-1: on read only the last ungrouped address is visible; an unrelated edit keeps both (#1418). */
    public function test_ct1_read_shows_one_address_but_edit_keeps_both(): void
    {
        $vcard = $this->vcard('4.0', "FN:Multi Adr\r\nN:Adr;Multi;;;\r\n"
            ."ADR;TYPE=home:;;Home St 1;Amsterdam;;1000 AA;NL\r\n"
            ."ADR;TYPE=work:;;Work St 2;Utrecht;;3500 BB;NL\r\n");

        $this->assertCount(1, $this->converter->cardFromVCard($vcard)['addresses']);

        $out = $this->edit($vcard);
        $this->assertStringContainsString('Home St 1', $out);
        $this->assertStringContainsString('Work St 2', $out);
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

    /** CT-4 (fixed for unrelated edits by #1418): Apple's year-less birthday keeps X-APPLE-OMIT-YEAR. */
    public function test_ct4_apple_yearless_birthday_survives_an_edit(): void
    {
        $out = $this->edit($this->vcard('3.0', "FN:Apple Bday\r\nN:Bday;Apple;;;\r\n"
            ."BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17\r\n"));

        $this->assertStringContainsString("BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17\r\n", $out);
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

    /** CT-6: vCard 3.0 TYPE=pref is still not read as pref; an unrelated edit keeps it (#1418). */
    public function test_ct6_type_pref_not_read_but_kept_on_edit(): void
    {
        $vcard = $this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."EMAIL;type=INTERNET;type=WORK:john@work.example\r\n"
            ."EMAIL;type=INTERNET;type=HOME;type=pref:john@home.example\r\n"
            ."TEL;type=CELL;type=VOICE;type=pref:+31 6 1234 5678\r\n");

        foreach ($this->converter->cardFromVCard($vcard)['emails'] as $email) {
            $this->assertArrayNotHasKey('pref', $email);
        }

        $out = strtolower($this->edit($vcard));
        $this->assertStringContainsString('home,pref:john@home.example', $out);
        $this->assertStringContainsString('voice,pref:+31 6 1234 5678', $out);
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

    /** CT-9: a multi-value NICKNAME is still read as one; an unrelated edit keeps the list (#1418). */
    public function test_ct9_nickname_read_as_one_but_list_kept_on_edit(): void
    {
        $vcard = $this->vcard('3.0', "FN:Al Bundy\r\nN:Bundy;Al;;;\r\nNICKNAME:Al,Ally\r\n");

        $this->assertCount(1, $this->converter->cardFromVCard($vcard)['nicknames']);
        $this->assertStringContainsString("NICKNAME:Al,Ally\r\n", $this->edit($vcard));
    }

    /** CT-10: changing an entry's context merges the contexts map, so the old context is kept. */
    public function test_ct10_context_change_does_not_replace_old_context(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\nEMAIL;PROP-ID=e1;TYPE=work:jd@example.com\r\n");

        // What the web app sends when the user switches the email from Work to Home (editDraftToPatch).
        $out = $this->edit($vcard, ['emails' => ['e1' => ['address' => 'jd@example.com', 'contexts' => ['private' => true]]]]);

        $this->assertStringContainsString('TYPE="home,work"', $out);
    }

    /** CT-10: RFC 8620 PatchObject pointer paths are ignored. */
    public function test_ct10_patch_object_pointer_paths_are_ignored(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\nEMAIL;PROP-ID=e1:a@example.com\r\nEMAIL;PROP-ID=e2:b@example.com\r\n");

        $this->assertStringContainsString('b@example.com', $this->edit($vcard, ['emails/e2' => null]));
    }

    /** CT-11 (fixed for unrelated edits by #1418): the ADR LABEL is not copied into an X-ABLabel. */
    public function test_ct11_adr_label_is_not_duplicated_on_edit(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=work;LABEL=\"Acme\\nDamrak 2\":;;Damrak 2;Amsterdam;;1012 LG;NL\r\n"));

        $this->assertStringContainsString('LABEL=Acme\nDamrak 2', $out);
        $this->assertStringNotContainsString('X-ABLABEL', $out);
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
