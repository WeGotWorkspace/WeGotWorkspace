<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\VCardJsContactConverter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class VCardJsContactConverterTest extends TestCase
{
    private VCardJsContactConverter $converter;

    private string $fixturesDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new VCardJsContactConverter;
        $this->fixturesDir = dirname(__DIR__, 2).'/fixtures/Contacts';
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function goldenFixtureProvider(): array
    {
        $fixtures = [];
        foreach (glob(dirname(__DIR__, 2).'/fixtures/Contacts/*.vcf') ?: [] as $path) {
            $name = basename($path, '.vcf');
            if ($name === 'apple-group-with-members') {
                continue;
            }
            $fixtures[$name] = [$name];
        }

        return $fixtures;
    }

    #[DataProvider('goldenFixtureProvider')]
    public function test_vcard_to_jscontact_matches_golden_fixture(string $fixture): void
    {
        $vcard = file_get_contents("{$this->fixturesDir}/{$fixture}.vcf");
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/{$fixture}.json"), true);

        $actual = $this->converter->cardFromVCard((string) $vcard);

        $this->assertSame($expected, $actual);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function reversibleFixtureProvider(): array
    {
        $reversible = [
            'fn-only',
            'structured-name',
            'emails',
            'address-legacy',
            'address-rfc9554',
            'organization',
            'note',
            'photo-uri',
            'photo-binary',
            'uid-metadata',
            'categories',
            'group',
            'multi-value',
            'full-contact',
            'anniversaries',
            'speak-to-as',
            'online-services',
            'languages',
            'geo-tz',
            'organizational-ext',
            'personal-info',
            'security-calendaring',
            'links-media',
            'kind-individual',
            'tel-features',
            'x-custom',
            'vendor-x-props',
        ];
        $fixtures = [];
        foreach ($reversible as $name) {
            $fixtures[$name] = [$name];
        }

        return $fixtures;
    }

    /**
     * RFC 9555 matrix vCard property rows → golden fixture that exercises the mapping.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function matrixPropertyRowProvider(): array
    {
        return [
            'KIND' => ['KIND', 'kind-individual'],
            'SOURCE' => ['SOURCE', 'organizational-ext'],
            'XML' => ['XML', 'preserve-only'],
            'FN' => ['FN', 'fn-only'],
            'N' => ['N', 'structured-name'],
            'NICKNAME' => ['NICKNAME', 'multi-value'],
            'PHOTO' => ['PHOTO', 'photo-uri'],
            'GENDER' => ['GENDER', 'preserve-only'],
            'GRAMGENDER' => ['GRAMGENDER', 'speak-to-as'],
            'PRONOUNS' => ['PRONOUNS', 'speak-to-as'],
            'BDAY' => ['BDAY', 'anniversaries'],
            'BIRTHPLACE' => ['BIRTHPLACE', 'anniversaries'],
            'DEATHDATE' => ['DEATHDATE', 'anniversaries'],
            'DEATHPLACE' => ['DEATHPLACE', 'anniversaries'],
            'ANNIVERSARY' => ['ANNIVERSARY', 'anniversaries'],
            'ADR' => ['ADR', 'address-rfc9554'],
            'EMAIL' => ['EMAIL', 'emails'],
            'TEL' => ['TEL', 'tel-features'],
            'IMPP' => ['IMPP', 'online-services'],
            'LANG' => ['LANG', 'languages'],
            'LANGUAGE' => ['LANGUAGE', 'languages'],
            'SOCIALPROFILE' => ['SOCIALPROFILE', 'online-services'],
            'GEO' => ['GEO', 'geo-tz'],
            'TZ' => ['TZ', 'geo-tz'],
            'ORG' => ['ORG', 'organization'],
            'TITLE' => ['TITLE', 'full-contact'],
            'ROLE' => ['ROLE', 'organizational-ext'],
            'MEMBER' => ['MEMBER', 'group'],
            'RELATED' => ['RELATED', 'organizational-ext'],
            'CONTACT-URI' => ['CONTACT-URI', 'organizational-ext'],
            'LOGO' => ['LOGO', 'organizational-ext'],
            'EXPERTISE' => ['EXPERTISE', 'personal-info'],
            'HOBBY' => ['HOBBY', 'personal-info'],
            'INTEREST' => ['INTEREST', 'personal-info'],
            'ORG-DIRECTORY' => ['ORG-DIRECTORY', 'organizational-ext'],
            'CATEGORIES' => ['CATEGORIES', 'categories'],
            'NOTE' => ['NOTE', 'note'],
            'PRODID' => ['PRODID', 'uid-metadata'],
            'CREATED' => ['CREATED', 'uid-metadata'],
            'REV' => ['REV', 'uid-metadata'],
            'SOUND' => ['SOUND', 'links-media'],
            'UID' => ['UID', 'fn-only'],
            'URL' => ['URL', 'links-media'],
            'VERSION' => ['VERSION', 'fn-only'],
            'CLIENTPIDMAP' => ['CLIENTPIDMAP', 'preserve-only'],
            'X-ABLabel' => ['X-ABLabel', 'multi-value'],
            'KEY' => ['KEY', 'security-calendaring'],
            'CALADRURI' => ['CALADRURI', 'security-calendaring'],
            'CALURI' => ['CALURI', 'security-calendaring'],
            'FBURL' => ['FBURL', 'security-calendaring'],
            'X-*' => ['X-CUSTOM-PROP', 'x-custom'],
        ];
    }

    #[DataProvider('matrixPropertyRowProvider')]
    public function test_matrix_property_row_is_covered_by_fixture(string $property, string $fixture): void
    {
        $vcard = (string) file_get_contents("{$this->fixturesDir}/{$fixture}.vcf");
        $this->assertStringContainsStringIgnoringCase($property, $vcard, "Fixture {$fixture} should contain {$property}");

        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/{$fixture}.json"), true);
        $actual = $this->converter->cardFromVCard($vcard);
        $this->assertSame($expected, $actual);
    }

    #[DataProvider('reversibleFixtureProvider')]
    public function test_jscontact_to_vcard_round_trip_preserves_card(string $fixture): void
    {
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/{$fixture}.json"), true);
        $vcard = $this->converter->vCardFromCard($expected);
        $roundTripped = $this->converter->cardFromVCard($vcard);

        $this->assertSame($expected, $roundTripped, "Round-trip mismatch for fixture {$fixture}");
    }

    public function test_jscontact_to_vcard_emits_fn_and_uid(): void
    {
        $card = json_decode((string) file_get_contents("{$this->fixturesDir}/fn-only.json"), true);
        $vcard = $this->converter->vCardFromCard($card);

        $this->assertStringContainsString('FN:John Q. Public\\, Esq.', $vcard);
        $this->assertStringContainsString('UID:urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6', $vcard);
        $this->assertStringContainsString('VERSION:4.0', $vcard);
    }

    public function test_derived_fn_when_name_full_missing(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'name' => [
                '@type' => 'Name',
                'components' => [
                    ['@type' => 'NameComponent', 'kind' => 'given', 'value' => 'Jane'],
                    ['@type' => 'NameComponent', 'kind' => 'surname', 'value' => 'Doe'],
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);

        $this->assertStringContainsString('FN;DERIVED=TRUE:Jane Doe', $vcard);
        $this->assertStringContainsString('N:Doe;Jane', $vcard);
    }

    public function test_generates_uid_when_vcard_lacks_uid(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:No UID Contact
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey('uid', $card);
        $this->assertStringStartsWith('urn:uuid:', (string) $card['uid']);
        $this->assertSame($card['uid'], $this->converter->cardFromVCard($vcard)['uid']);
    }

    public function test_voice_tel_without_explicit_type_defaults_to_voice_feature(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Voice Default
UID:urn:uuid:dddddddd-dddd-4ddd-8ddd-dddddddddddd
TEL:tel:+1-555-0100
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $phone = reset($card['phones']);
        $this->assertIsArray($phone);
        $this->assertSame(['voice' => true], $phone['features'] ?? null);

        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));
        $roundTrippedPhone = reset($roundTripped['phones']);
        $this->assertIsArray($roundTrippedPhone);
        $this->assertSame(['voice' => true], $roundTrippedPhone['features'] ?? null);

        $vcard = $this->converter->vCardFromCard($card);
        $this->assertStringNotContainsStringIgnoringCase('TYPE=voice', $vcard);
    }

    public function test_phone_home_work_context_round_trips_without_voice_type(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'name' => ['@type' => 'Name', 'full' => 'Context Phones'],
            'phones' => [
                'home-phone' => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0100',
                    'contexts' => ['private' => true],
                ],
                'work-phone' => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0200',
                    'contexts' => ['work' => true],
                ],
                'school-phone' => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0300',
                    'contexts' => ['school' => true],
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $this->assertStringContainsStringIgnoringCase('TYPE=home', $vcard);
        $this->assertStringContainsStringIgnoringCase('TYPE=work', $vcard);
        $this->assertStringContainsStringIgnoringCase('TYPE=school', $vcard);
        $this->assertStringNotContainsStringIgnoringCase('TYPE=voice', $vcard);

        $roundTripped = $this->converter->cardFromVCard($vcard);
        $homePhone = null;
        $workPhone = null;
        $schoolPhone = null;
        foreach ($roundTripped['phones'] ?? [] as $phone) {
            if (! is_array($phone)) {
                continue;
            }
            $contexts = $phone['contexts'] ?? null;
            if ($contexts === ['private' => true]) {
                $homePhone = $phone;
            } elseif ($contexts === ['work' => true]) {
                $workPhone = $phone;
            } elseif ($contexts === ['school' => true]) {
                $schoolPhone = $phone;
            }
        }
        $this->assertIsArray($homePhone);
        $this->assertIsArray($workPhone);
        $this->assertIsArray($schoolPhone);
    }

    public function test_company_card_round_trips_kind_org_and_x_abshowas(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Acme Corp
UID:urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff
ORG:Acme Corp
X-ABShowAs:COMPANY
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame('org', $card['kind'] ?? null);

        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps'] ?? []);
        $this->assertNotContains('X-ABShowAs', $names);

        $out = $this->converter->vCardFromCard($card);
        $this->assertStringContainsString('KIND:org', $out);
        $this->assertStringContainsStringIgnoringCase('X-ABSHOWAS:COMPANY', $out);
    }

    public function test_kind_org_writes_x_abshowas_company(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:12121212-1212-4212-8212-121212121212',
            'kind' => 'org',
            'name' => ['@type' => 'Name', 'full' => 'Widgets Inc'],
            'organizations' => [
                'org-1' => ['@type' => 'Organization', 'name' => 'Widgets Inc'],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $this->assertStringContainsString('KIND:org', $vcard);
        $this->assertStringContainsStringIgnoringCase('X-ABSHOWAS:COMPANY', $vcard);
    }

    public function test_version_preserved_in_vcard_props(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/fn-only.vcf"));

        $this->assertArrayHasKey('vCardProps', $card);
        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('VERSION', $names);
    }

    public function test_gender_preserved_in_vcard_props(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/preserve-only.vcf"));

        $this->assertArrayNotHasKey('gender', $card);
        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('GENDER', $names);
    }

    public function test_xml_preserved_in_vcard_props(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/preserve-only.vcf"));

        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('XML', $names);
    }

    public function test_clientpidmap_preserved_in_vcard_props(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/preserve-only.vcf"));

        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('CLIENTPIDMAP', $names);
    }

    public function test_x_custom_property_preserved_in_vcard_props(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/x-custom.vcf"));

        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('X-CUSTOM-PROP', $names);
    }

    public function test_derived_fn_skipped_on_read(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN;DERIVED=TRUE:Jane Doe
UID:urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc
N:Doe;Jane;;;
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey('name', $card);
        $this->assertArrayNotHasKey('full', $card['name']);
        $this->assertArrayHasKey('components', $card['name']);
    }

    public function test_tz_uri_preserved_in_vcard_props(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
UID:urn:uuid:25252525-2525-4252-8252-252525252525
TZ;VALUE=uri:http://example.com/tz/invalid
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('TZ', $names);
    }

    public function test_categories_pref_order_not_preserved(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
UID:urn:uuid:26262626-2626-4262-8262-262626262626
CATEGORIES;PREF=1:alpha
CATEGORIES;PREF=2:beta
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertSame(['alpha' => true, 'beta' => true], $card['keywords']);
        $this->assertArrayNotHasKey(0, $card['keywords']);
    }

    public function test_member_pref_not_converted(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
KIND:group
FN:Group
UID:urn:uuid:27272727-2727-4272-8272-272727272727
MEMBER;PREF=1:urn:uuid:11111111-1111-4111-8111-111111111111
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertSame(['urn:uuid:11111111-1111-4111-8111-111111111111' => true], $card['members']);
    }

    public function test_expertise_level_mapping(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/personal-info.vcf"));

        $expertise = null;
        foreach ($card['personalInfo'] ?? [] as $entry) {
            if (is_array($entry) && ($entry['kind'] ?? '') === 'expertise') {
                $expertise = $entry;
                break;
            }
        }
        $this->assertIsArray($expertise);
        $this->assertSame('low', $expertise['level']);
        $vcard = $this->converter->vCardFromCard($card);
        $this->assertStringContainsStringIgnoringCase('LEVEL=beginner', $vcard);
    }

    public function test_related_text_value_has_empty_relation(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents("{$this->fixturesDir}/organizational-ext.vcf"));

        $this->assertSame([], $card['relatedTo']['My former manager']['relation']);
    }

    public function test_bday_no_year_maps_to_birth_anniversary(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
UID:urn:uuid:28282828-2828-4282-8282-282828282828
BDAY;VALUE=date:--0315
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey('anniversaries', $card);
        $birth = array_values(
            array_filter($card['anniversaries'], static fn (array $a): bool => ($a['kind'] ?? '') === 'birth'),
        );
        $this->assertCount(1, $birth);
        $this->assertSame('PartialDate', $birth[0]['date']['@type']);
        $this->assertSame(3, $birth[0]['date']['month']);
        $this->assertSame(15, $birth[0]['date']['day']);
        $this->assertArrayNotHasKey('year', $birth[0]['date']);
    }

    /** Apple Contacts writes BDAY with hyphens (YYYY-MM-DD) — vCard 3.0 extended format. */
    public function test_apple_bday_with_year_hyphenated_maps_to_birth_anniversary(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Thomas Copier
UID:urn:uuid:apple-thomas-copier-0000-000000000001
BDAY:1985-03-15
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey('anniversaries', $card);
        $birth = array_values(
            array_filter($card['anniversaries'], static fn (array $a): bool => ($a['kind'] ?? '') === 'birth'),
        );
        $this->assertCount(1, $birth);
        $this->assertSame('PartialDate', $birth[0]['date']['@type']);
        $this->assertSame(1985, $birth[0]['date']['year']);
        $this->assertSame(3, $birth[0]['date']['month']);
        $this->assertSame(15, $birth[0]['date']['day']);
    }

    /** Apple Contacts writes no-year BDAY as --MM-DD (extended no-year format). */
    public function test_apple_bday_without_year_hyphenated_maps_to_birth_anniversary(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Thomas Copier
UID:urn:uuid:apple-thomas-copier-0000-000000000002
BDAY:--03-15
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey('anniversaries', $card);
        $birth = array_values(
            array_filter($card['anniversaries'], static fn (array $a): bool => ($a['kind'] ?? '') === 'birth'),
        );
        $this->assertCount(1, $birth);
        $this->assertSame('PartialDate', $birth[0]['date']['@type']);
        $this->assertSame(3, $birth[0]['date']['month']);
        $this->assertSame(15, $birth[0]['date']['day']);
        $this->assertArrayNotHasKey('year', $birth[0]['date']);
    }

    /** Apple BDAY with year round-trips without data loss. */
    public function test_apple_bday_with_year_round_trips(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Thomas Copier
UID:urn:uuid:apple-thomas-copier-0000-000000000003
BDAY:1985-03-15
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));

        $this->assertSame($card['anniversaries'], $roundTripped['anniversaries']);
    }

    /** Apple no-year BDAY round-trips without data loss (writes --MMDD per RFC 6350). */
    public function test_apple_bday_without_year_round_trips(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Thomas Copier
UID:urn:uuid:apple-thomas-copier-0000-000000000004
BDAY:--03-15
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));

        $this->assertSame($card['anniversaries'], $roundTripped['anniversaries']);
    }

    public function test_vcard_with_prop_id_uses_prop_id_as_map_key(): void
    {
        $propId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        $vcard = <<<VCARD
BEGIN:VCARD
VERSION:4.0
FN:Prop Id Reader
UID:urn:uuid:30303030-3030-4030-8030-303030303030
EMAIL;PROP-ID={$propId}:reader@example.com
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertArrayHasKey($propId, $card['emails']);
        $this->assertSame('reader@example.com', $card['emails'][$propId]['address']);
    }

    public function test_round_trip_preserves_prop_id_map_keys(): void
    {
        $propId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:31313131-3131-4131-8131-313131313131',
            'name' => ['@type' => 'Name', 'full' => 'Round Trip'],
            'emails' => [
                $propId => [
                    '@type' => 'EmailAddress',
                    'address' => 'roundtrip@example.com',
                ],
            ],
        ];

        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));

        $this->assertArrayHasKey($propId, $roundTripped['emails']);
        $this->assertSame('roundtrip@example.com', $roundTripped['emails'][$propId]['address']);
        $this->assertStringContainsString('PROP-ID='.$propId, $this->converter->vCardFromCard($card));
    }

    public function test_vcard_without_prop_id_uses_stable_hash_fallback(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Legacy Contact
UID:urn:uuid:32323232-3232-4232-8232-323232323232
EMAIL:legacy@example.com
TEL;TYPE=cell:+1-555-0100
END:VCARD
VCARD;

        $first = $this->converter->cardFromVCard($vcard);
        $second = $this->converter->cardFromVCard($vcard);

        $this->assertSame(array_keys($first['emails']), array_keys($second['emails']));
        $this->assertSame(array_keys($first['phones']), array_keys($second['phones']));
        foreach (array_keys($first['emails']) as $key) {
            $this->assertStringStartsWith('p_', $key);
        }
    }

    public function test_full_only_address_emits_populated_legacy_adr(): void
    {
        $propId = '927a78e8-b83e-467b-aecd-f0bb80a309c5';
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f',
            'name' => ['@type' => 'Name', 'full' => 'Mike Ackermans'],
            'addresses' => [
                $propId => [
                    '@type' => 'Address',
                    'full' => 'Main Street 123',
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $unfolded = str_replace(["\r\n ", "\n "], '', $vcard);

        $this->assertStringContainsString('ADR;PROP-ID='.$propId, $unfolded);
        $this->assertStringContainsString(';;Main Street 123', $unfolded);
        $this->assertStringNotContainsString('ADR;PROP-ID='.$propId.':;;;;;;', $unfolded);
    }

    public function test_structured_address_patch_round_trips_to_legacy_adr(): void
    {
        $propId = '550e8400-e29b-41d4-a716-446655440003';
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:55555555-5555-4555-8555-555555555555',
            'name' => ['@type' => 'Name', 'full' => 'Jane Doe'],
            'addresses' => [
                $propId => [
                    '@type' => 'Address',
                    'components' => [
                        ['@type' => 'AddressComponent', 'kind' => 'name', 'value' => '123 Main St'],
                        ['@type' => 'AddressComponent', 'kind' => 'locality', 'value' => 'Springfield'],
                        ['@type' => 'AddressComponent', 'kind' => 'region', 'value' => 'IL'],
                        ['@type' => 'AddressComponent', 'kind' => 'postcode', 'value' => '62704'],
                        ['@type' => 'AddressComponent', 'kind' => 'country', 'value' => 'USA'],
                    ],
                    'isOrdered' => false,
                    'contexts' => ['private' => true],
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $unfolded = str_replace(["\r\n ", "\n "], '', $vcard);

        $this->assertStringContainsString('ADR;PROP-ID='.$propId, $unfolded);
        $this->assertStringContainsString(';;123 Main St;Springfield;IL;62704;USA', $unfolded);
        $roundTripped = $this->converter->cardFromVCard($vcard);
        $this->assertSame($card['addresses'][$propId]['components'], $roundTripped['addresses'][$propId]['components']);
    }

    public function test_vendor_x_props_round_trip_preserves_all_props(): void
    {
        $vcard = (string) file_get_contents("{$this->fixturesDir}/vendor-x-props.vcf");
        $card = $this->converter->cardFromVCard($vcard);

        $propNames = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps'] ?? []);
        $this->assertContains('X-PHONETIC-FIRST-NAME', $propNames);
        $this->assertContains('X-PHONETIC-LAST-NAME', $propNames);
        $this->assertContains('X-MS-IMADDRESS', $propNames);
        $this->assertContains('X-MOZILLA-HTML', $propNames);
        $this->assertContains('X-EVOLUTION-FILE-AS', $propNames);
        $this->assertContains('X-SOCIALPROFILE', $propNames);

        $written = $this->converter->vCardFromCard($card);

        $this->assertStringContainsString('X-PHONETIC-FIRST-NAME:Jane', $written);
        $this->assertStringContainsString('X-PHONETIC-LAST-NAME:Doe', $written);
        $this->assertStringContainsString('X-MS-IMADDRESS:jane@msn.com', $written);
        $this->assertStringContainsString('X-MOZILLA-HTML:FALSE', $written);
        $this->assertStringContainsString('X-EVOLUTION-FILE-AS:Doe Jane', $written);
        $this->assertStringNotContainsStringIgnoringCase('VALUE=UNKNOWN', $written);

        $roundTripped = $this->converter->cardFromVCard($written);
        $this->assertSame($card['vCardProps'], $roundTripped['vCardProps']);
    }

    public function test_apple_label_only_adr_import_maps_full_to_street_on_round_trip(): void
    {
        $propId = '927a78e8-b83e-467b-aecd-f0bb80a309c5';
        $vcard = <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Mike Ackermans
UID:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
item1.X-ABLABEL:Main Street 123
item1.ADR;PROP-ID={$propId};LABEL=Main Street 123:;;;;;;
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame('Main Street 123', $card['addresses'][$propId]['full']);

        $card['addresses'][$propId] = [
            '@type' => 'Address',
            'components' => [
                ['@type' => 'AddressComponent', 'kind' => 'name', 'value' => 'Main Street 123'],
            ],
            'isOrdered' => false,
        ];

        $rewritten = $this->converter->vCardFromCard($card);
        $unfolded = str_replace(["\r\n ", "\n "], '', $rewritten);
        $this->assertStringContainsString(';;Main Street 123', $unfolded);
        $this->assertStringNotContainsString('ADR;PROP-ID='.$propId.':;;;;;;', $unfolded);
    }

    public function test_outbound_emits_x_ablabel_with_prop_id_and_type_for_standard_contexts(): void
    {
        $phoneHomeId = '550e8400-e29b-41d4-a716-446655440101';
        $phoneMobileId = '550e8400-e29b-41d4-a716-446655440102';
        $phoneBareId = '550e8400-e29b-41d4-a716-446655440103';
        $emailWorkId = '550e8400-e29b-41d4-a716-446655440104';
        $addrHomeId = '550e8400-e29b-41d4-a716-446655440105';
        $urlWorkId = '550e8400-e29b-41d4-a716-446655440106';
        $phoneCustomId = '550e8400-e29b-41d4-a716-446655440107';

        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'name' => ['@type' => 'Name', 'full' => 'Label Card'],
            'phones' => [
                $phoneHomeId => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0100',
                    'contexts' => ['private' => true],
                ],
                $phoneMobileId => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0101',
                    'features' => ['mobile' => true],
                ],
                $phoneBareId => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0102',
                ],
                $phoneCustomId => [
                    '@type' => 'Phone',
                    'number' => '+1-555-0103',
                    'contexts' => ['work' => true],
                    'label' => 'Gym',
                ],
            ],
            'emails' => [
                $emailWorkId => [
                    '@type' => 'EmailAddress',
                    'address' => 'work@example.com',
                    'contexts' => ['work' => true],
                ],
            ],
            'addresses' => [
                $addrHomeId => [
                    '@type' => 'Address',
                    'contexts' => ['private' => true],
                    'components' => [
                        ['@type' => 'AddressComponent', 'kind' => 'name', 'value' => '1 Main St'],
                    ],
                ],
            ],
            'links' => [
                $urlWorkId => [
                    '@type' => 'Link',
                    'uri' => 'https://work.example',
                    'contexts' => ['work' => true],
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $unfolded = str_replace(["\r\n ", "\n "], '', $vcard);

        $this->assertMatchesRegularExpression('/item\d+\.TEL;PROP-ID='.$phoneHomeId.';TYPE=home:/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.X-ABLABEL:Home/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.TEL;PROP-ID='.$phoneMobileId.';TYPE=cell:/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.X-ABLABEL:Mobile/i', $unfolded);
        $this->assertMatchesRegularExpression('/TEL;PROP-ID='.$phoneBareId.':/i', $unfolded);
        $this->assertDoesNotMatchRegularExpression('/item\d+\.TEL;PROP-ID='.$phoneBareId.'/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.TEL;PROP-ID='.$phoneCustomId.';TYPE=work:/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.X-ABLABEL:Gym/i', $unfolded);

        $this->assertMatchesRegularExpression('/item\d+\.EMAIL;PROP-ID='.$emailWorkId.';TYPE=work:/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.X-ABLABEL:Work/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.ADR;PROP-ID='.$addrHomeId.';TYPE=home/i', $unfolded);
        $this->assertMatchesRegularExpression('/item\d+\.URL;PROP-ID='.$urlWorkId.';TYPE=work/i', $unfolded);

        $roundTripped = $this->converter->cardFromVCard($vcard);
        $this->assertSame($phoneHomeId, array_key_first(
            array_filter(
                $roundTripped['phones'] ?? [],
                static fn ($phone): bool => is_array($phone) && ($phone['contexts'] ?? null) === ['private' => true],
            ),
        ));
        $this->assertSame(['mobile' => true], $roundTripped['phones'][$phoneMobileId]['features'] ?? null);
        $this->assertArrayNotHasKey('label', $roundTripped['phones'][$phoneHomeId] ?? []);
        $this->assertArrayNotHasKey('label', $roundTripped['phones'][$phoneMobileId] ?? []);
        $this->assertSame('Gym', $roundTripped['phones'][$phoneCustomId]['label'] ?? null);
    }

    public function test_outbound_notes_emit_note_property_with_prop_id(): void
    {
        $noteId = '550e8400-e29b-41d4-a716-446655440201';
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'name' => ['@type' => 'Name', 'full' => 'Notes Card'],
            'notes' => [
                $noteId => [
                    '@type' => 'Note',
                    'note' => 'Bring badge to lobby',
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $unfolded = str_replace(["\r\n ", "\n "], '', $vcard);

        $this->assertStringContainsString('NOTE;PROP-ID='.$noteId.':Bring badge to lobby', $unfolded);

        $roundTripped = $this->converter->cardFromVCard($vcard);
        $this->assertSame('Bring badge to lobby', $roundTripped['notes'][$noteId]['note'] ?? null);
    }
}
