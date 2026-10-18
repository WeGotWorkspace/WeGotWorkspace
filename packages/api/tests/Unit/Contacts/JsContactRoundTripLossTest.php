<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\ConversionSupport;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use PHPUnit\Framework\TestCase;

/**
 * Characterization tests for round-trip data loss on ContactCard edits.
 *
 * Each test replays the ContactCard/set and REST PATCH update path
 * (ContactCardRepository::patchWithPrecondition): read the stored vCard into
 * JSContact, deep-merge the client patch, normalize map keys, rebuild the vCard
 * from JSContact. Inputs are what Apple Contacts, Thunderbird and DAVx5 write.
 * The media blob step (ContactMediaBlobResolver) is an identity for inline
 * base64 photos and is not replayed.
 *
 * These tests pin CURRENT (lossy) behavior so the gaps in
 * docs/architecture/jscontact-conformance.md stay provable. The fix for a
 * finding (CT-n) flips the matching assertions.
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

    /** CT-1: ungrouped ADR properties share one bucket, so only the last address survives. */
    public function test_ct1_only_the_last_ungrouped_address_survives(): void
    {
        $vcard = $this->vcard('4.0', "FN:Multi Adr\r\nN:Adr;Multi;;;\r\n"
            ."ADR;TYPE=home:;;Home St 1;Amsterdam;;1000 AA;NL\r\n"
            ."ADR;TYPE=work:;;Work St 2;Utrecht;;3500 BB;NL\r\n");

        $this->assertCount(1, $this->converter->cardFromVCard($vcard)['addresses']);

        $out = $this->edit($vcard);
        $this->assertStringNotContainsString('Home St 1', $out);
        $this->assertStringContainsString('Work St 2', $out);
    }

    /** CT-2: generated lowercase itemN groups collide with the client's ITEMN groups; labels move between properties. */
    public function test_ct2_generated_item_groups_collide_and_labels_move(): void
    {
        $vcard = $this->vcard('3.0', "FN:Els Lab\r\nN:Lab;Els;;;\r\n"
            ."item1.EMAIL;type=INTERNET:els@other.example\r\n"
            ."item1.X-ABLabel:_\$!<Other>!\$_\r\n"
            ."TEL;type=HOME;type=FAX:+31 20 000 0003\r\n");

        $first = $this->edit($vcard);
        $this->assertStringContainsString('ITEM1.X-ABLABEL:_$!<Other>!$_', $first);
        $this->assertStringContainsString('item1.X-ABLABEL:Home', $first);
        $this->assertStringContainsString('ITEM1.EMAIL;', $first);
        $this->assertStringContainsString(';GROUP=ITEM1:els@other.example', $first);
        $this->assertStringContainsString('item1.TEL;', $first);

        // The second edit reads both labels into one case-insensitive group: the email is now labelled "Home".
        $second = $this->edit($first);
        $this->assertStringContainsString('ITEM1.X-ABLABEL:Home', $second);
        $this->assertStringNotContainsString('_$!<Other>!$_', $second);
    }

    /** CT-3: labels and groups of item properties WGW does not model are lost. */
    public function test_ct3_apple_item_labels_on_unmodelled_properties_are_lost(): void
    {
        $out = $this->edit($this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."item1.X-ABRELATEDNAMES;type=pref:Jane Doe\r\n"
            ."item1.X-ABLabel:_\$!<Spouse>!\$_\r\n"
            ."item2.X-ABDATE:2020-01-01\r\n"
            ."item2.X-ABLabel:First met\r\n"
            ."item3.URL;type=pref:https://example.com\r\n"
            ."item3.X-ABLabel:_\$!<HomePage>!\$_\r\n"
            ."item4.ADR;type=HOME:;;Damrak 1;Amsterdam;;1012 LG;Netherlands\r\n"
            ."item4.X-ABADR:nl\r\n"));

        $this->assertStringContainsString("\r\nX-ABRELATEDNAMES;TYPE=pref:Jane Doe\r\n", $out);
        $this->assertStringContainsString("\r\nX-ABDATE:2020-01-01\r\n", $out);
        $this->assertStringContainsString("\r\nX-ABADR:nl\r\n", $out);
        $this->assertStringNotContainsString('Spouse', $out);
        $this->assertStringNotContainsString('First met', $out);
        $this->assertStringNotContainsString('HomePage', $out);
    }

    /** CT-4: Apple's year-less birthday loses X-APPLE-OMIT-YEAR, so the contact is born in 1604. */
    public function test_ct4_apple_yearless_birthday_gets_year_1604(): void
    {
        $out = $this->edit($this->vcard('3.0', "FN:Apple Bday\r\nN:Bday;Apple;;;\r\n"
            ."BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17\r\n"));

        $this->assertStringNotContainsString('X-APPLE-OMIT-YEAR', $out);
        $this->assertStringContainsString('VALUE=DATE:16040517', $out);
    }

    /** CT-5: unknown and preserve-only values are escaped again on every edit. */
    public function test_ct5_unknown_property_values_are_escaped_again_on_every_edit(): void
    {
        $vcard = $this->vcard('4.0', "FN:John Doe\r\n"
            ."CLIENTPIDMAP:1;urn:uuid:3df403f4-5924-4bb7-b077-3c711d9eb34b\r\n"
            ."X-MULTI:a,b\r\n"
            ."X-ANDROID-CUSTOM:vnd.android.cursor.item/nickname;Janey;1;;\r\n");

        $first = $this->edit($vcard);
        $this->assertStringContainsString('CLIENTPIDMAP:1,urn:uuid:', $first);
        $this->assertStringContainsString('X-MULTI:a\,b', $first);
        $this->assertStringContainsString('X-ANDROID-CUSTOM:vnd.android.cursor.item/nickname\\\\\\;Janey', $first);

        $second = $this->edit($first);
        $this->assertStringContainsString('CLIENTPIDMAP:1\,urn:uuid:', $second);
        $this->assertStringContainsString('X-MULTI:a\\\\\\,b', $second);
    }

    /** CT-6: vCard 3.0 TYPE=pref is not read as pref, so the preferred email/phone is lost. */
    public function test_ct6_vcard3_type_pref_is_lost(): void
    {
        $vcard = $this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."EMAIL;type=INTERNET;type=WORK:john@work.example\r\n"
            ."EMAIL;type=INTERNET;type=HOME;type=pref:john@home.example\r\n"
            ."TEL;type=CELL;type=VOICE;type=pref:+31 6 1234 5678\r\n");

        foreach ($this->converter->cardFromVCard($vcard)['emails'] as $email) {
            $this->assertArrayNotHasKey('pref', $email);
        }

        $out = $this->edit($vcard);
        $this->assertStringNotContainsStringIgnoringCase('pref', $out);
    }

    /** CT-7: parameters WGW does not model are dropped from known properties. */
    public function test_ct7_unmodelled_parameters_on_known_properties_are_dropped(): void
    {
        $out = $this->edit($this->vcard('3.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."EMAIL;PID=1.1;TYPE=work;X-EVOLUTION-UI-SLOT=1:jd@work.example\r\n"
            ."IMPP;X-SERVICE-TYPE=Facebook;type=HOME:xmpp:john@chat.example\r\n"
            ."PHOTO;ENCODING=b;TYPE=JPEG;X-ABCROP-RECTANGLE=ABClipRect_1&0&0&64&64&abc=:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD\r\n"));

        $this->assertStringContainsString('jd@work.example', $out);
        $this->assertStringNotContainsString('PID=', $out);
        $this->assertStringNotContainsString('X-EVOLUTION-UI-SLOT', $out);
        $this->assertStringNotContainsString('X-SERVICE-TYPE', $out);
        $this->assertStringNotContainsString('Facebook', $out);
        $this->assertStringContainsString('ENCODING=b;TYPE=JPEG:/9j/', $out);
        $this->assertStringNotContainsString('X-ABCROP-RECTANGLE', $out);
    }

    /** CT-8: values of known properties are rewritten into invalid or different values. */
    public function test_ct8_known_property_values_are_corrupted(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\nN:Doe;John;;;\r\n"
            ."TEL;VALUE=uri;TYPE=\"voice,cell\":tel:+31612345678;ext=12\r\n"
            ."ADR;GEO=\"geo:52.37,4.89\";TYPE=home:;;Damrak 1;Amsterdam;;1012 LG;Netherlands\r\n"
            ."RELATED;TYPE=spouse;VALUE=text:Jane Doe\r\n"));

        // tel: URI written as escaped text: the extension separator becomes "\;".
        $this->assertStringContainsString(':tel:+31612345678\;ext=12', $out);
        $this->assertStringNotContainsString('VALUE=uri', $out);
        // GEO parameter loses its geo: scheme (RFC 6350 requires a URI).
        $this->assertStringContainsString('GEO="52.37,4.89"', $out);
        // Free-text RELATED loses VALUE=text, so "Jane Doe" is now an invalid URI.
        $this->assertStringContainsString("\r\nRELATED;TYPE=spouse:Jane Doe\r\n", $out);
    }

    /** CT-9: a multi-value NICKNAME collapses into one nickname with an escaped comma. */
    public function test_ct9_multi_value_nickname_collapses(): void
    {
        $vcard = $this->vcard('3.0', "FN:Al Bundy\r\nN:Bundy;Al;;;\r\nNICKNAME:Al,Ally\r\n");

        $this->assertCount(1, $this->converter->cardFromVCard($vcard)['nicknames']);
        $this->assertStringContainsString(':Al\,Ally', $this->edit($vcard));
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

    /** CT-11: the ADR LABEL parameter is also written as an Apple X-ABLabel with escaped newlines. */
    public function test_ct11_adr_label_parameter_is_duplicated_into_x_ablabel(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=work;LABEL=\"Acme\\nDamrak 2\":;;Damrak 2;Amsterdam;;1012 LG;NL\r\n"));

        $this->assertStringContainsString('LABEL=Acme\nDamrak 2', $out);
        $this->assertStringContainsString('.X-ABLABEL:Acme\\\\nDamrak 2', $out);
    }

    /** CT-12: a card-level TZ is moved into an ADR TZ parameter; the TZ property disappears. */
    public function test_ct12_tz_property_moves_into_address_parameter(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\n"
            ."ADR;TYPE=home:;;Damrak 1;Amsterdam;;1012 LG;NL\r\n"
            ."TZ;VALUE=TEXT:Europe/Amsterdam\r\n"));

        $this->assertStringNotContainsString("\r\nTZ", $out);
        $this->assertStringContainsString('TZ=Europe/Amsterdam', $out);
    }

    /** CT-13: the time of a timestamp ANNIVERSARY is dropped. */
    public function test_ct13_anniversary_timestamp_loses_its_time(): void
    {
        $out = $this->edit($this->vcard('4.0', "FN:John Doe\r\nANNIVERSARY:20100601T120000Z\r\n"));

        $this->assertStringContainsString('VALUE=DATE:20100601', $out);
        $this->assertStringNotContainsString('T120000Z', $out);
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

        return $this->unfold($this->converter->vCardFromCard(ConversionSupport::syncGroupDisplayName($merged)));
    }

    private function unfold(string $vcard): string
    {
        return str_replace("\r\n ", '', $vcard);
    }
}
