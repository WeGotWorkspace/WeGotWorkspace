<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\VCardJsContactConverter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * JSContact → vCard → JSContact round trips, one property family at a time,
 * plus the vCard 3.0 write path and RFC 9555 localizations. The golden
 * fixtures in VCardJsContactConverterTest start from vCard; these start from
 * what the web app writes, so a change to either converter half shows here.
 *
 * Tests named `*_is_lost` or `*_replaces_*` pin CURRENT lossy behaviour (the
 * JsContactRoundTripLossTest convention); fixing the gap flips them.
 */
final class JsContactVCardRoundTripTest extends TestCase
{
    private VCardJsContactConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new VCardJsContactConverter;
    }

    /**
     * @return iterable<string, array{0: array<string, mixed>}>
     */
    public static function propertyFamilies(): iterable
    {
        yield 'emails with contexts and pref' => [[
            'emails' => [
                'e1' => ['address' => 'ada@work.example', 'contexts' => ['work' => true], 'pref' => 1],
                'e2' => ['address' => 'ada@home.example', 'contexts' => ['private' => true]],
            ],
        ]];
        yield 'phones with features' => [[
            'phones' => [
                'p1' => ['number' => '+44 20 1234', 'features' => ['mobile' => true, 'text' => true], 'contexts' => ['private' => true]],
                'p2' => ['number' => '+44 20 9999', 'features' => ['fax' => true]],
            ],
        ]];
        yield 'address with coordinates and time zone' => [[
            'addresses' => [
                'a1' => [
                    'components' => [
                        ['kind' => 'name', 'value' => '12 St James Square'],
                        ['kind' => 'locality', 'value' => 'London'],
                        ['kind' => 'postcode', 'value' => 'SW1'],
                        ['kind' => 'country', 'value' => 'UK'],
                    ],
                    'isOrdered' => false,
                    'contexts' => ['private' => true],
                    'timeZone' => 'Europe/London',
                    'coordinates' => 'geo:51.5,-0.13',
                ],
            ],
        ]];
        yield 'organization with units' => [[
            'organizations' => ['o1' => ['name' => 'Analytical Engines', 'units' => [['name' => 'Research']]]],
        ]];
        yield 'title and role' => [[
            'titles' => [
                't1' => ['name' => 'Mathematician', 'kind' => 'title'],
                't2' => ['name' => 'Lead', 'kind' => 'role'],
            ],
        ]];
        yield 'keywords' => [['keywords' => ['math' => true, 'computing' => true]]];
        yield 'nicknames' => [['nicknames' => ['k1' => ['name' => 'Countess']]]];
        yield 'notes' => [['notes' => ['n1' => ['note' => 'First programmer, 1843']]]];
        yield 'preferred languages' => [[
            'preferredLanguages' => [
                'l1' => ['language' => 'en', 'pref' => 1],
                'l2' => ['language' => 'fr', 'contexts' => ['work' => true]],
            ],
        ]];
        yield 'online service' => [[
            'onlineServices' => ['s1' => [
                'service' => 'Mastodon',
                'user' => '@ada@example.social',
                'uri' => 'https://example.social/@ada',
                'vCardName' => 'impp',
            ]],
        ]];
        yield 'links' => [['links' => ['w1' => ['uri' => 'https://ada.example', 'contexts' => ['private' => true]]]]];
        yield 'calendar, scheduling address and crypto key' => [[
            'calendars' => ['c1' => ['kind' => 'calendar', 'uri' => 'https://cal.example/ada.ics']],
            'schedulingAddresses' => ['sa1' => ['uri' => 'mailto:ada@work.example']],
            'cryptoKeys' => ['ck1' => ['uri' => 'https://keys.example/ada.asc']],
        ]];
        yield 'related card' => [['relatedTo' => ['urn:uuid:charles' => ['relation' => ['friend' => true]]]]];
        yield 'speak to as' => [[
            'speakToAs' => ['grammaticalGender' => 'feminine', 'pronouns' => ['pr1' => ['pronouns' => 'she/her']]],
        ]];
        yield 'photo by uri' => [[
            'media' => ['m1' => ['kind' => 'photo', 'uri' => 'https://img.example/ada.png', 'mediaType' => 'image/png']],
        ]];
        yield 'birthday as a timestamp, anniversary with a calendar scale' => [[
            'anniversaries' => [
                'k1' => ['kind' => 'birth', 'date' => ['@type' => 'Timestamp', 'utc' => '1990-05-01T10:00:00Z']],
                'k2' => ['kind' => 'wedding', 'date' => ['@type' => 'PartialDate', 'year' => 2010, 'month' => 6, 'day' => 12, 'calendarScale' => 'gregorian']],
            ],
        ]];
        yield 'organization card' => [['kind' => 'org', 'name' => ['full' => 'Analytical Engines Ltd']]];
    }

    /**
     * @param  array<string, mixed>  $fields
     */
    #[DataProvider('propertyFamilies')]
    public function test_property_family_round_trips(array $fields): void
    {
        $card = $this->card($fields);

        $back = $this->roundTrip($card);

        foreach ($fields as $key => $value) {
            $this->assertEquals(
                $this->withoutTypes($value),
                $this->withoutTypes($back[$key] ?? null),
                $key.' changed on the way through vCard',
            );
        }
    }

    public function test_uid_kind_and_name_survive_a_round_trip_of_a_full_card(): void
    {
        $fields = [];
        foreach (self::propertyFamilies() as $case) {
            $fields += $case[0];
        }
        unset($fields['kind'], $fields['name']);
        $card = $this->card($fields);

        $back = $this->roundTrip($card);

        $this->assertSame('urn:uuid:round-trip', $back['uid']);
        $this->assertSame('Ada Lovelace', $back['name']['full']);
        $this->assertSame(array_keys($fields), array_values(array_intersect(array_keys($fields), array_keys($back))));
    }

    public function test_unordered_name_components_and_sort_as_round_trip(): void
    {
        $back = $this->roundTrip($this->card(['name' => [
            'components' => [
                ['kind' => 'given', 'value' => 'Anna'],
                ['kind' => 'surname', 'value' => 'de Vries'],
            ],
            'sortAs' => ['surname' => 'Vries', 'given' => 'Anna'],
        ]]));

        $this->assertSame(['surname' => 'Vries', 'given' => 'Anna'], $back['name']['sortAs']);
        $this->assertFalse($back['name']['isOrdered']);
        $this->assertEqualsCanonicalizing(
            [['kind' => 'given', 'value' => 'Anna'], ['kind' => 'surname', 'value' => 'de Vries']],
            $this->withoutTypes($back['name']['components']),
        );
    }

    public function test_sort_as_is_written_as_one_n_parameter(): void
    {
        $vcard = $this->converter->vCardFromCard($this->card(['name' => [
            'components' => [['kind' => 'surname', 'value' => 'de Vries'], ['kind' => 'given', 'value' => 'Anna']],
            'sortAs' => ['surname' => 'Vries', 'given' => 'Anna'],
        ]]));

        $this->assertStringContainsString("N;SORT-AS=\"Vries,Anna\":de Vries;Anna;;;;;\r\n", $vcard);
        $this->assertStringContainsString("FN;DERIVED=TRUE:Anna de Vries\r\n", $vcard);
    }

    public function test_ordered_name_round_trips_through_jscomps(): void
    {
        $name = [
            'isOrdered' => true,
            'defaultSeparator' => '-',
            'components' => [['kind' => 'surname', 'value' => 'Li'], ['kind' => 'given', 'value' => 'Wei']],
        ];

        $vcard = $this->converter->vCardFromCard($this->card(['name' => $name]));
        $back = $this->converter->cardFromVCard($vcard);

        $this->assertStringContainsString('N;JSCOMPS="s,-;0;1":Li;Wei;;;;;', $vcard);
        $this->assertTrue($back['name']['isOrdered']);
        $this->assertSame('-', $back['name']['defaultSeparator']);
        $this->assertSame($name['components'], $this->withoutTypes($back['name']['components']));
    }

    /**
     * @return iterable<string, array{0: string, 1: ?string}>
     */
    public static function jscompsDefaultSeparators(): iterable
    {
        yield 'explicit s, entry' => ['s,-;0;1', '-'];
        yield 'bare leading value' => ['-;0;1', '-'];
        yield 'empty leading entry' => [';0;1', null];
        yield 'no default entry' => ['0;1', null];
    }

    #[DataProvider('jscompsDefaultSeparators')]
    public function test_jscomps_default_separator_forms_are_read(string $jscomps, ?string $expected): void
    {
        $card = $this->converter->cardFromVCard(
            "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:j\r\nFN:Li Wei\r\nN;JSCOMPS=\"{$jscomps}\":Li;Wei;;;;;\r\nEND:VCARD\r\n",
        );

        $this->assertTrue($card['name']['isOrdered']);
        $this->assertSame($expected, $card['name']['defaultSeparator'] ?? null);
        $this->assertSame(['Li', 'Wei'], array_column($card['name']['components'], 'value'));
    }

    /** Known gap: a separator component keeps its text but loses surrounding spaces. */
    public function test_separator_whitespace_and_a_space_default_separator_is_lost(): void
    {
        $back = $this->roundTrip($this->card(['name' => [
            'isOrdered' => true,
            'defaultSeparator' => ' ',
            'components' => [
                ['kind' => 'surname', 'value' => 'Li'],
                ['kind' => 'separator', 'value' => ', '],
                ['kind' => 'given', 'value' => 'Wei'],
            ],
        ]]));

        $this->assertSame(',', $back['name']['components'][1]['value']);
        $this->assertArrayNotHasKey('defaultSeparator', $back['name']);
    }

    /** Known gap: TITLE has no ORG link in vCard, so organizationId is dropped. */
    public function test_title_organization_id_is_lost(): void
    {
        $back = $this->roundTrip($this->card([
            'organizations' => ['o1' => ['name' => 'Analytical Engines']],
            'titles' => ['t1' => ['name' => 'Mathematician', 'kind' => 'title', 'organizationId' => 'o1']],
        ]));

        $this->assertSame('Mathematician', $back['titles']['t1']['name']);
        $this->assertArrayNotHasKey('organizationId', $back['titles']['t1']);
    }

    public function test_vcard3_writes_pref_as_a_type_value(): void
    {
        $vcard = $this->converter->vCardFromCard($this->vcard3Card([
            'emails' => ['e1' => ['address' => 'ada@work.example', 'contexts' => ['work' => true], 'pref' => 1]],
            'preferredLanguages' => ['l1' => ['language' => 'en', 'pref' => 1]],
        ]));

        $this->assertStringStartsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n", $vcard);
        $this->assertStringContainsString('EMAIL;PROP-ID=e1;TYPE=work,pref:ada@work.example', $vcard);
        $this->assertStringContainsString("LANG;PROP-ID=l1;TYPE=pref:en\r\n", $vcard);
        $this->assertStringNotContainsString('PREF=1', $vcard);

        $back = $this->converter->cardFromVCard($vcard);
        $this->assertSame(1, $back['emails']['e1']['pref']);
        $this->assertSame(['work' => true], $back['emails']['e1']['contexts']);
    }

    /**
     * @return iterable<string, array{0: string, 1: ?string}>
     */
    public static function vcard3PhotoTypes(): iterable
    {
        yield 'jpeg' => ['image/jpeg', 'JPEG'];
        yield 'png' => ['image/png', 'PNG'];
        yield 'gif' => ['image/gif', 'GIF'];
        yield 'webp' => ['image/webp', 'WEBP'];
        yield 'bmp' => ['image/bmp', 'BMP'];
        yield 'tiff' => ['image/tiff', 'TIFF'];
        yield 'svg' => ['image/svg+xml', 'SVG'];
    }

    #[DataProvider('vcard3PhotoTypes')]
    public function test_vcard3_inline_photo_uses_encoding_b_and_a_type(string $mediaType, string $type): void
    {
        $vcard = $this->converter->vCardFromCard($this->vcard3Card([
            'media' => ['m1' => ['kind' => 'photo', 'uri' => 'data:'.$mediaType.';base64,AAAA', 'mediaType' => $mediaType]],
        ]));

        $this->assertStringContainsString("PHOTO;PROP-ID=m1;ENCODING=b;TYPE={$type}:AAAA\r\n", $vcard);
        $this->assertSame(
            'data:'.$mediaType.';base64,AAAA',
            $this->converter->cardFromVCard($vcard)['media']['m1']['uri'],
        );
    }

    /** Known gap: a vCard 3.0 photo type without a well-known TYPE name reads back as octet-stream. */
    public function test_vcard3_photo_of_an_unmapped_type_is_lost(): void
    {
        $vcard = $this->converter->vCardFromCard($this->vcard3Card([
            'media' => ['m1' => ['kind' => 'photo', 'uri' => 'data:image/heic;base64,AAAA', 'mediaType' => 'image/heic']],
        ]));

        $this->assertStringContainsString("PHOTO;PROP-ID=m1;ENCODING=b:AAAA\r\n", $vcard);
        $this->assertSame(
            'data:application/octet-stream;base64,AAAA',
            $this->converter->cardFromVCard($vcard)['media']['m1']['uri'],
        );
    }

    public function test_localized_full_name_round_trips(): void
    {
        $card = $this->card(['localizations' => ['nl' => ['name/full' => 'Ada Lovelace-NL']]]);

        $vcard = $this->converter->vCardFromCard($card);
        $back = $this->converter->cardFromVCard($vcard);

        $this->assertStringContainsString("FN;LANGUAGE=nl:Ada Lovelace-NL\r\n", $vcard);
        $this->assertSame('Ada Lovelace', $back['name']['full']);
        $this->assertSame(['nl' => ['name/full' => 'Ada Lovelace-NL']], $back['localizations']);
    }

    public function test_localizations_skip_empty_values_unknown_pointers_and_the_primary_name(): void
    {
        $vcard = $this->converter->vCardFromCard($this->card(['localizations' => [
            'DE' => ['name/full' => 'Ada Lovelace'],
            'fr' => ['name/full' => '', 'titles/t1/name' => 'Mathématicienne'],
            '' => ['name/full' => 'Nameless'],
            'es' => 'not a patch',
        ]]));

        $this->assertStringNotContainsString('LANGUAGE=', $vcard);
        $this->assertArrayNotHasKey('localizations', $this->converter->cardFromVCard($vcard));
    }

    public function test_fn_language_values_are_read_lowercased_and_without_duplicates(): void
    {
        $card = $this->converter->cardFromVCard(
            "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:g\r\nFN:G\r\nFN;LANGUAGE=FR:Jean\r\nFN;LANGUAGE=de:G\r\nEND:VCARD\r\n",
        );

        $this->assertSame('G', $card['name']['full']);
        $this->assertSame(['fr' => ['name/full' => 'Jean']], $card['localizations']);
    }

    public function test_a_note_only_in_one_language_is_both_the_note_and_its_localization(): void
    {
        $card = $this->converter->cardFromVCard(
            "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:g\r\nFN:G\r\nNOTE;LANGUAGE=nl;PROP-ID=n1:Alleen NL\r\nEND:VCARD\r\n",
        );

        $this->assertSame('Alleen NL', $card['notes']['n1']['note']);
        $this->assertSame(['nl' => ['notes/n1/note' => 'Alleen NL']], $card['localizations']);
    }

    public function test_localized_note_and_address_are_written_with_the_base_prop_id(): void
    {
        $vcard = $this->converter->vCardFromCard($this->card([
            'notes' => ['n1' => ['note' => 'Hello']],
            'addresses' => ['a1' => ['components' => [['kind' => 'locality', 'value' => 'Amsterdam']]]],
            'localizations' => ['nl' => [
                'notes/n1/note' => 'Hallo, wereld',
                'addresses/a1/full' => 'Dam 1, Amsterdam',
            ]],
        ]));

        $this->assertStringContainsString("NOTE;PROP-ID=n1:Hello\r\n", $vcard);
        $this->assertStringContainsString("NOTE;LANGUAGE=nl;PROP-ID=n1:Hallo\\, wereld\r\n", $vcard);
        $this->assertStringContainsString("ADR;LANGUAGE=nl;LABEL=\"Dam 1, Amsterdam\";PROP-ID=a1:;;;;;;\r\n", $vcard);
    }

    /**
     * Known gap: on read, the localized NOTE and ADR share the base PROP-ID and
     * overwrite the base entry, so the base note text and address components
     * do not come back. RFC 9555 keeps the unlocalized property as the base.
     */
    public function test_localized_note_and_address_replace_the_base_entry_on_read(): void
    {
        $back = $this->roundTrip($this->card([
            'notes' => ['n1' => ['note' => 'Hello']],
            'addresses' => ['a1' => ['components' => [['kind' => 'locality', 'value' => 'Amsterdam']]]],
            'localizations' => ['nl' => [
                'notes/n1/note' => 'Hallo, wereld',
                'addresses/a1/full' => 'Dam 1, Amsterdam',
            ]],
        ]));

        $this->assertSame('Hallo, wereld', $back['notes']['n1']['note']);
        $this->assertSame([], $back['addresses']['a1']['components']);
        $this->assertSame('Dam 1, Amsterdam', $back['addresses']['a1']['full']);
        $this->assertEquals(
            ['notes/n1/note' => 'Hallo, wereld', 'addresses/a1/full' => 'Dam 1, Amsterdam'],
            $back['localizations']['nl'],
        );
    }

    public function test_two_ungrouped_addresses_keep_geo_and_tz_as_their_own_entries(): void
    {
        $card = $this->converter->cardFromVCard(
            "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:g\r\nFN:G\r\n"
            ."ADR:;;Main 1;Town;;;\r\nADR:;;Side 2;Village;;;\r\nGEO:geo:52.1,4.3\r\nTZ:Europe/Amsterdam\r\nEND:VCARD\r\n",
        );

        $addresses = array_values($card['addresses']);
        $this->assertCount(4, $addresses);
        $this->assertSame(['Main 1', 'Town'], array_column($addresses[0]['components'], 'value'));
        $this->assertSame(['@type' => 'Address', 'coordinates' => 'geo:52.1,4.3'], $addresses[1]);
        $this->assertSame(['@type' => 'Address', 'timeZone' => 'Europe/Amsterdam'], $addresses[2]);
        $this->assertSame(['Side 2', 'Village'], array_column($addresses[3]['components'], 'value'));
    }

    public function test_geo_and_tz_without_an_address_become_minimal_addresses(): void
    {
        $card = $this->converter->cardFromVCard(
            "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:g\r\nFN:G\r\nGEO:geo:52.1,4.3\r\nTZ:Europe/Amsterdam\r\nEND:VCARD\r\n",
        );

        $this->assertSame(
            [['@type' => 'Address', 'coordinates' => 'geo:52.1,4.3'], ['@type' => 'Address', 'timeZone' => 'Europe/Amsterdam']],
            array_values($card['addresses']),
        );
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    private function card(array $fields): array
    {
        return array_replace([
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:round-trip',
            'name' => ['full' => 'Ada Lovelace'],
        ], $fields);
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    private function vcard3Card(array $fields): array
    {
        return $this->card($fields + ['vCardProps' => [['VERSION', [], 'text', ['3.0']]]]);
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    private function roundTrip(array $card): array
    {
        return $this->converter->cardFromVCard($this->converter->vCardFromCard($card));
    }

    /**
     * The reader adds `@type` to every object; the web app may leave it out.
     */
    private function withoutTypes(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        unset($value['@type']);

        return array_map(fn (mixed $item): mixed => $this->withoutTypes($item), $value);
    }
}
