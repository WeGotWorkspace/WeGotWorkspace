<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\ContactCardVcfImportSupport;
use App\Services\Contacts\Conversion\ConversionSupport;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Reader;

/** Covers GitHub issues #151–#156 acceptance criteria. */
final class ContactsIssueGapTest extends TestCase
{
    private VCardJsContactConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new VCardJsContactConverter;
    }

    public function test_localizations_from_fn_language_round_trip(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:John Smith
FN;LANGUAGE=fr:Jean Dupont
UID:urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame('John Smith', $card['name']['full']);
        $this->assertSame('Jean Dupont', $card['localizations']['fr']['name/full']);

        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));
        $this->assertSame('Jean Dupont', $roundTripped['localizations']['fr']['name/full']);
    }

    public function test_jscopms_ordered_address_round_trip(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            'name' => ['@type' => 'Name', 'full' => 'Jane Doe'],
            'addresses' => [
                'addr-1' => [
                    '@type' => 'Address',
                    'isOrdered' => true,
                    'components' => [
                        ['@type' => 'AddressComponent', 'kind' => 'number', 'value' => '54321'],
                        ['@type' => 'AddressComponent', 'kind' => 'separator', 'value' => ' '],
                        ['@type' => 'AddressComponent', 'kind' => 'name', 'value' => 'Oak St'],
                        ['@type' => 'AddressComponent', 'kind' => 'locality', 'value' => 'Reston'],
                    ],
                    'defaultSeparator' => ', ',
                ],
            ],
        ];

        $vcard = $this->converter->vCardFromCard($card);
        $this->assertStringContainsStringIgnoringCase('JSCOMPS', $vcard);
        $roundTripped = $this->converter->cardFromVCard($vcard);
        $address = reset($roundTripped['addresses']);
        $this->assertIsArray($address);
        $this->assertTrue($address['isOrdered'] ?? false);
    }

    public function test_geo_tz_adr_merge_into_single_address(): void
    {
        $card = $this->converter->cardFromVCard((string) file_get_contents(
            dirname(__DIR__, 2).'/fixtures/Contacts/geo-tz.vcf',
        ));

        $merged = null;
        foreach ($card['addresses'] ?? [] as $address) {
            if (! is_array($address)) {
                continue;
            }
            if (isset($address['coordinates'], $address['components'], $address['timeZone'])
                && ($address['timeZone'] ?? '') === 'Europe/Amsterdam') {
                $merged = $address;
            }
        }

        $this->assertIsArray($merged);
        $this->assertSame('geo:40.7128,-74.0060', $merged['coordinates'] ?? null);
        $this->assertCount(2, $card['addresses']);
    }

    public function test_group_members_preserve_missing_uids(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
KIND:group
FN:Nested Group
UID:urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
MEMBER:urn:uuid:11111111-1111-4111-8111-111111111111
MEMBER:urn:uuid:missing-member-uid
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame([
            'urn:uuid:11111111-1111-4111-8111-111111111111' => true,
            'urn:uuid:missing-member-uid' => true,
        ], $card['members']);

        $roundTripped = $this->converter->cardFromVCard($this->converter->vCardFromCard($card));
        $this->assertSame($card['members'], $roundTripped['members']);
    }

    public function test_apple_addressbookserver_group_converts_to_kind_and_members(): void
    {
        $vcard = (string) file_get_contents(
            dirname(__DIR__, 2).'/fixtures/Contacts/apple-group-with-members.vcf',
        );
        $groupChunk = ContactCardVcfImportSupport::splitVcards($vcard)[2];

        $card = $this->converter->cardFromVCard($groupChunk);

        $this->assertSame('group', $card['kind']);
        $this->assertSame([
            'urn:uuid:a1111111-1111-4111-8111-111111111111' => true,
            'urn:uuid:a2222222-2222-4222-8222-222222222222' => true,
        ], $card['members']);

        $propNames = array_map(
            static fn (array $tuple): string => (string) $tuple[0],
            $card['vCardProps'] ?? [],
        );
        $this->assertNotContains('X-ADDRESSBOOKSERVER-KIND', $propNames);
        $this->assertNotContains('X-ADDRESSBOOKSERVER-MEMBER', $propNames);
        $this->assertNotContains('MEMBER', $propNames);
    }

    public function test_apple_addressbookserver_group_converts_to_kind_and_members_legacy(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $this->assertSame('group', $card['kind']);
        $this->assertSame([
            'urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f' => true,
            'urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a' => true,
        ], $card['members']);

        $propNames = array_map(
            static fn (array $tuple): string => (string) $tuple[0],
            $card['vCardProps'] ?? [],
        );
        $this->assertNotContains('X-ADDRESSBOOKSERVER-KIND', $propNames);
        $this->assertNotContains('X-ADDRESSBOOKSERVER-MEMBER', $propNames);
    }

    public function test_group_rename_patch_syncs_fn_and_structured_n(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $merged = ConversionSupport::deepMergeContactCardPatch($card, [
            'name' => [
                '@type' => 'Name',
                'isOrdered' => false,
                'full' => 'Close Friends',
            ],
        ]);
        $merged = ConversionSupport::syncGroupDisplayName($merged);

        $this->assertSame('Close Friends', $merged['name']['full']);
        $this->assertSame('Close Friends', $merged['name']['components'][0]['value'] ?? null);

        $written = $this->converter->vCardFromCard($merged);
        $this->assertStringContainsString('FN:Close Friends', $written);
        $this->assertStringContainsString('N:Close Friends', $written);
        $this->assertStringNotContainsString('N:Friends', $written);
        $this->assertStringNotContainsString('FN:Friends', $written);
    }

    public function test_apple_group_write_emits_x_addressbookserver_kind_and_member(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
N:Friends;;;;
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $written = $this->converter->vCardFromCard($card);

        // Apple round-trip: X-ADDRESSBOOKSERVER-KIND must be present so Apple Contacts.app
        // recognises the card as a group after a server-side write.
        $this->assertStringContainsStringIgnoringCase('X-ADDRESSBOOKSERVER-KIND:group', $written);
        // Members must also be written in Apple format alongside standard MEMBER.
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f', $written);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a', $written);
        // Standard RFC 6350 properties must also be present.
        $this->assertStringContainsStringIgnoringCase('KIND:group', $written);
        $this->assertStringContainsString('MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f', $written);
    }

    public function test_vcard4_group_write_emits_only_rfc6350_kind_and_member(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'kind' => 'group',
            'name' => ['@type' => 'Name', 'full' => 'Test Group'],
            'members' => [
                'urn:uuid:11111111-1111-4111-8111-111111111111' => true,
                'urn:uuid:22222222-2222-4222-8222-222222222222' => true,
            ],
        ];

        $written = $this->converter->vCardFromCard($card);

        // A vCard 4.0 group carries only RFC 6350 KIND/MEMBER. Sabre converts them to
        // X-ADDRESSBOOKSERVER-KIND/-MEMBER when a 3.0 client (Apple Contacts) reads the card;
        // writing both made 3.0 readers get every line twice (#1457, verified with Apple Contacts).
        $this->assertStringContainsString("\r\nKIND:group\r\n", $written);
        $this->assertStringContainsString("\r\nMEMBER:urn:uuid:11111111-1111-4111-8111-111111111111\r\n", $written);
        $this->assertStringContainsString("\r\nMEMBER:urn:uuid:22222222-2222-4222-8222-222222222222\r\n", $written);
        $this->assertStringNotContainsString('X-ADDRESSBOOKSERVER-', $written);
    }

    public function test_group_write_normalizes_bare_member_uids_to_urn_uuid(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => '08430ef3-a2ce-4568-9d6c-f50a6cfd32ae',
            'kind' => 'group',
            'name' => ['@type' => 'Name', 'full' => 'Friends'],
            'members' => [
                'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f' => true,
                'urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a' => true,
            ],
        ];

        $written = $this->converter->vCardFromCard($card);

        $this->assertStringContainsString('MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f', $written);
        $this->assertStringContainsString('MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a', $written);
        $this->assertStringNotContainsString('MEMBER:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f', $written);
    }

    public function test_group_write_deduplicates_mixed_member_uid_key_formats(): void
    {
        $card = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => '08430ef3-a2ce-4568-9d6c-f50a6cfd32ae',
            'kind' => 'group',
            'name' => ['@type' => 'Name', 'full' => 'Friends'],
            'members' => [
                'c4cf6038-5da0-41be-9c2d-d8cb9b4af90f' => true,
                'urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f' => true,
            ],
        ];

        $written = $this->converter->vCardFromCard($card);
        $memberLines = preg_match_all('/^MEMBER:/m', $written, $matches) ? count($matches[0]) : 0;
        $appleMemberLines = preg_match_all('/^X-ADDRESSBOOKSERVER-MEMBER:/m', $written, $appleMatches) ? count($appleMatches[0]) : 0;

        $this->assertSame(1, $memberLines);
        $this->assertSame(0, $appleMemberLines, 'vCard 4.0 groups write MEMBER only (#1457)');
    }

    public function test_apple_group_round_trip_preserves_kind_and_members(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:My Group
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
UID:ffffffff-ffff-4fff-8fff-ffffffffffff
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame('group', $card['kind'] ?? null);
        $this->assertSame(['urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' => true], $card['members'] ?? null);

        // Full round-trip: written → re-read must still be a group with the same members.
        $written = $this->converter->vCardFromCard($card);
        $roundTripped = $this->converter->cardFromVCard($written);
        $this->assertSame('group', $roundTripped['kind'] ?? null);
        $this->assertSame(['urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' => true], $roundTripped['members'] ?? null);
    }

    public function test_multiple_fn_without_language_preserved_in_vcard_props(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Primary Name
FN:Alternate Name
UID:urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);
        $this->assertSame('Primary Name', $card['name']['full']);
        $names = array_map(static fn (array $tuple): string => (string) $tuple[0], $card['vCardProps']);
        $this->assertContains('FN', $names);
    }

    /**
     * Apple-synced contacts use vCard 3.0 PHOTO;ENCODING=b;TYPE=JPEG which differs
     * from vCard 4.0 PHOTO;MEDIATYPE=image/jpeg. Without mapping TYPE→MIME the
     * photo is stored as application/octet-stream and the browser cannot display it.
     */
    public function test_apple_vcard3_binary_photo_type_maps_to_image_mime(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Fadi Alset
UID:urn:uuid:fad1fad1-fad1-4fad-8fad-fad1fad1fad1
PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJ
 CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wA
 ALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/
 2gAIAQEAAD8AVIP/2Q==
END:VCARD
VCARD;

        $card = $this->converter->cardFromVCard($vcard);

        $media = $card['media'] ?? [];
        $this->assertNotEmpty($media, 'media map must not be empty');
        $entry = reset($media);
        $this->assertSame('photo', $entry['kind']);
        $this->assertStringStartsWith(
            'data:image/jpeg;base64,',
            $entry['uri'],
            'vCard 3.0 TYPE=JPEG must be resolved to image/jpeg MIME type',
        );
    }

    public function test_apple_vcard3_binary_photo_png_type_maps_to_image_mime(): void
    {
        // Minimal 1×1 transparent PNG
        $pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        $vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nUID:urn:uuid:12345678-0000-4000-8000-000000000001\r\nPHOTO;ENCODING=b;TYPE=PNG:{$pngB64}\r\nEND:VCARD\r\n";

        $card = $this->converter->cardFromVCard($vcard);

        $media = $card['media'] ?? [];
        $this->assertNotEmpty($media);
        $entry = reset($media);
        $this->assertStringStartsWith('data:image/png;base64,', $entry['uri']);
    }

    /**
     * When a vCard 3.0 contact (Apple-synced) is written back via JMAP, the binary
     * PHOTO must keep vCard 3.0 parameters (ENCODING=b;TYPE=JPEG), not the vCard 4.0
     * VALUE=BINARY;MEDIATYPE form. Apple Contacts cannot read the 4.0 parameters in
     * a VERSION:3.0 document, causing the avatar to disappear after any JMAP write.
     */
    public function test_vcard3_binary_photo_write_back_uses_encoding_b_not_mediatype(): void
    {
        $b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
            .'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/'
            .'EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==';

        $vcard = implode("\r\n", [
            'BEGIN:VCARD',
            'VERSION:3.0',
            'FN:Test User',
            'UID:urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'PHOTO;ENCODING=b;TYPE=JPEG:'.$b64,
            'END:VCARD',
            '',
        ]);

        // Read → JSContact → write back
        $jscontact = $this->converter->cardFromVCard($vcard);
        $written = $this->converter->vCardFromCard($jscontact);

        // The written vCard must be valid vCard 3.0 binary photo
        $this->assertStringContainsString('VERSION:3.0', $written, 'vCard version must be preserved');
        $this->assertStringContainsStringIgnoringCase('ENCODING=b', $written,
            'vCard 3.0 write-back must use ENCODING=b, not VALUE=BINARY');
        $this->assertStringContainsStringIgnoringCase('TYPE=JPEG', $written,
            'vCard 3.0 write-back must use TYPE=JPEG, not MEDIATYPE=image/jpeg');
        $this->assertStringNotContainsStringIgnoringCase('MEDIATYPE', $written,
            'vCard 3.0 write-back must not emit MEDIATYPE (vCard 4.0 only)');
        $this->assertStringNotContainsStringIgnoringCase('VALUE=BINARY', $written,
            'vCard 3.0 write-back must not emit VALUE=BINARY (vCard 4.0 only)');

        // Binary payload must survive the round-trip intact
        $doc = Reader::read($written);
        $photo = $doc->PHOTO;
        $this->assertNotNull($photo, 'PHOTO property must be present after write-back');
        $binaryFromOriginal = base64_decode(str_replace([' ', "\r", "\n"], '', $b64));
        $this->assertSame(
            $binaryFromOriginal,
            (string) $photo->getValue(),
            'Binary pixel data must survive the JSContact round-trip unchanged',
        );
    }

    /**
     * vCard 4.0 contacts must still emit VALUE=BINARY;MEDIATYPE (unchanged behaviour).
     */
    public function test_vcard4_binary_photo_write_back_uses_mediatype(): void
    {
        $b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        $dataUri = 'data:image/png;base64,'.$b64;

        $jscontact = [
            '@type' => 'Card',
            'version' => '1.0',
            'uid' => 'urn:uuid:11111111-2222-3333-4444-555555555555',
            'name' => ['full' => 'Test User', '@type' => 'Name'],
            'media' => [
                'p_test' => ['@type' => 'Media', 'kind' => 'photo', 'uri' => $dataUri],
            ],
        ];

        $written = $this->converter->vCardFromCard($jscontact);

        $this->assertStringContainsString('VERSION:4.0', $written, 'vCard version must default to 4.0');
        $this->assertStringContainsStringIgnoringCase('MEDIATYPE=image/png', $written,
            'vCard 4.0 binary photo must emit MEDIATYPE');
        $this->assertStringNotContainsStringIgnoringCase('ENCODING=b', $written,
            'vCard 4.0 must not emit vCard 3.0 ENCODING=b');
    }
}
