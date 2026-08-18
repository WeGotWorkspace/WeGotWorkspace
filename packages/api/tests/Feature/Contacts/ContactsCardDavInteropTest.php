<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Models\Addressbook;
use App\Models\Card;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CardDAV ↔ JMAP round-trip interoperability for the contacts domain.
 */
final class ContactsCardDavInteropTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_jmap_create_persists_readable_vcard_in_carddav_storage(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $payload = [
            'uid' => $uid,
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'Interoperable Contact'],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'interop@test.example',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($payload);
        $this->assertNotSame('', $cardId);

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored, 'JMAP-created card should exist in CardDAV cards table.');

        $vcard = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('FN:Interoperable Contact', $vcard);
        $this->assertStringContainsString('UID:'.$uid, $vcard);
        $this->assertStringContainsString('interop@test.example', $vcard);
        $this->assertSame(
            $stored->uri,
            str_ends_with($cardId, '.vcf') ? $cardId : $cardId.'.vcf',
            'Card URI should match JMAP card id with .vcf suffix.',
        );
    }

    public function test_jmap_create_updates_carddav_search_index(): void
    {
        $payload = [
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'Searchable Interop Contact'],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'searchinterop@example.com',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($payload);
        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);

        $sourceKey = $this->cardDavSearchSourceKey('bob', 'default', (string) $stored->uri);
        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_type', 'carddav')
            ->where('source_key', $sourceKey)
            ->first();

        $this->assertNotNull($row, 'JMAP create should index the CardDAV contact.');
        $this->assertSame('contact', $row->category);
        $this->assertSame('bob', $row->owner_username);
        $this->assertStringContainsString('Searchable Interop Contact', (string) $row->title);
        $this->assertStringContainsString('searchinterop@example.com', (string) $row->body_text);

        $search = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/search/results?'.http_build_query([
                'q' => 'searchinterop',
                'sources' => ['carddav'],
                'limit' => 10,
            ]));

        $search->assertOk();
        $sourceTypes = array_map(
            static fn (array $hit): string => (string) ($hit['sourceType'] ?? ''),
            $search->json('data.results') ?? [],
        );
        $this->assertContains('carddav', $sourceTypes);
    }

    public function test_carddav_write_is_readable_via_jmap_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:CardDAV Writer\r\nN:Writer;CardDAV;;;\r\nEMAIL:carddav-writer@example.com\r\nEND:VCARD\r\n";

        $cardId = $this->seedCardViaPdo('bob', 'carddav-writer.vcf', $vcard);
        $card = $this->jmapGetContactCard($cardId);

        $this->assertSame($cardId, $card['id'] ?? null);
        $this->assertSame('Card', $card['@type'] ?? null);
        $this->assertSame('1.0', $card['version'] ?? null);
        $this->assertSame($uid, $card['uid'] ?? null);
        $this->assertTrue($card['addressBookIds']['default'] ?? false);
        $this->assertSame('CardDAV Writer', $card['name']['full'] ?? null);

        $emails = $card['emails'] ?? null;
        $this->assertIsArray($emails);
        $addresses = array_map(
            static fn (array $entry): string => (string) ($entry['address'] ?? ''),
            array_values($emails),
        );
        $this->assertContains('carddav-writer@example.com', $addresses);
    }

    public function test_carddav_update_is_reflected_in_jmap_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $initial = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:Before Update\r\nEMAIL:before@example.com\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'round-trip-update.vcf', $initial);

        $updated = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:After CardDAV Update\r\nEMAIL:after@example.com\r\nEND:VCARD\r\n";
        $this->updateCardViaPdo('bob', 'round-trip-update.vcf', $updated);

        $card = $this->jmapGetContactCard($cardId);
        $this->assertSame('After CardDAV Update', $card['name']['full'] ?? null);

        $emails = $card['emails'] ?? null;
        $this->assertIsArray($emails);
        $addresses = array_map(
            static fn (array $entry): string => (string) ($entry['address'] ?? ''),
            array_values($emails),
        );
        $this->assertContains('after@example.com', $addresses);
        $this->assertNotContains('before@example.com', $addresses);
    }

    public function test_carddav_put_without_prop_id_backfills_prop_id_for_jmap_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:Prop Id Backfill\r\nEMAIL:backfill@example.com\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'prop-id-backfill.vcf', $vcard);

        $this->ensurePropIdsOnStoredCard('bob', 'prop-id-backfill.vcf');

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('PROP-ID=', $raw);

        $first = $this->jmapGetContactCard($cardId);
        $emailKeys = array_keys($first['emails'] ?? []);
        $this->assertCount(1, $emailKeys);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $emailKeys[0],
        );

        $second = $this->jmapGetContactCard($cardId);
        $this->assertSame($emailKeys, array_keys($second['emails'] ?? []));
    }

    public function test_carddav_update_preserves_email_prop_id_key(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $emailPropId = (string) Str::uuid();
        $initial = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:Before\r\nEMAIL;PROP-ID={$emailPropId}:before@example.com\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'prop-id-stable.vcf', $initial);

        $updated = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:After\r\nEMAIL;PROP-ID={$emailPropId}:after@example.com\r\nEND:VCARD\r\n";
        $this->updateCardViaPdo('bob', 'prop-id-stable.vcf', $updated);
        $this->ensurePropIdsOnStoredCard('bob', 'prop-id-stable.vcf');

        $card = $this->jmapGetContactCard($cardId);
        $this->assertSame('after@example.com', $card['emails'][$emailPropId]['address'] ?? null);
        $this->assertSame([$emailPropId], array_keys($card['emails'] ?? []));
    }

    public function test_jmap_create_writes_prop_id_and_second_get_uses_same_keys(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $payload = [
            'uid' => $uid,
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'REST Prop Id'],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'rest-prop-id@example.com',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($payload);
        $created = $this->jmapGetContactCard($cardId);
        $firstKeys = array_keys($created['emails'] ?? []);
        $this->assertCount(1, $firstKeys);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $firstKeys[0],
        );

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('PROP-ID='.$firstKeys[0], $raw);

        $second = $this->jmapGetContactCard($cardId);
        $this->assertSame($firstKeys, array_keys($second['emails'] ?? []));
    }

    public function test_jmap_set_updates_email_value_but_preserves_prop_id_key(): void
    {
        $createPayload = [
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'Mutable Email'],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'before@example.com',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($createPayload);
        $created = $this->jmapGetContactCard($cardId);
        $emailKey = array_key_first($created['emails'] ?? []);
        $this->assertIsString($emailKey);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => [
                'emails' => [$emailKey => ['address' => 'after@example.com']],
            ]]], 'c0'],
        ])->assertOk();

        $updated = $this->jmapGetContactCard($cardId);
        $this->assertSame('after@example.com', $updated['emails'][$emailKey]['address'] ?? null);

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('PROP-ID='.$emailKey, $raw);
        $this->assertStringContainsString('after@example.com', $raw);
        $this->assertStringNotContainsString('before@example.com', $raw);
    }

    public function test_jmap_set_persists_readable_vcard_with_prop_id_preservation(): void
    {
        $emailKey = '550e8400-e29b-41d4-a716-446655440001';
        $createPayload = [
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'Patch Interop Contact'],
            'emails' => [
                $emailKey => [
                    'address' => 'before@example.com',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($createPayload);

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => [
                'emails' => [$emailKey => ['address' => 'patched@example.com']],
            ]]], 'c0'],
        ])->assertOk();

        $patched = $this->jmapGetContactCard($cardId);
        $this->assertSame('patched@example.com', $patched['emails'][$emailKey]['address'] ?? null);

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('PROP-ID='.$emailKey, $raw);
        $this->assertStringContainsString('patched@example.com', $raw);
        $this->assertStringNotContainsString('before@example.com', $raw);
    }

    public function test_carddav_write_after_jmap_create_preserves_prop_ids(): void
    {
        $payload = [
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'CardDAV After REST'],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'preserve@example.com',
                ],
            ],
        ];

        $cardId = $this->jmapCreateContactCard($payload);
        $created = $this->jmapGetContactCard($cardId);
        $emailKey = array_key_first($created['emails'] ?? []);
        $this->assertIsString($emailKey);

        $stored = $this->findBobCard($cardId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $updated = str_replace(
            'FN:CardDAV After REST',
            'FN:CardDAV After REST Updated',
            $raw,
        );
        $this->updateCardViaPdo('bob', (string) $stored->uri, $updated);
        $this->ensurePropIdsOnStoredCard('bob', (string) $stored->uri);

        $card = $this->jmapGetContactCard($cardId);
        $this->assertSame('CardDAV After REST Updated', $card['name']['full'] ?? null);
        $this->assertSame('preserve@example.com', $card['emails'][$emailKey]['address'] ?? null);
        $this->assertSame([$emailKey], array_keys($card['emails'] ?? []));
    }

    private function findBobCard(string $cardId): ?Card
    {
        $cardUri = str_ends_with($cardId, '.vcf') ? $cardId : $cardId.'.vcf';
        $bookIds = Addressbook::query()
            ->where('principaluri', 'principals/bob')
            ->pluck('id');

        return Card::query()
            ->whereIn('addressbookid', $bookIds)
            ->where(function ($query) use ($cardId, $cardUri): void {
                $query->where('uri', $cardId)
                    ->orWhere('uri', $cardUri);
            })
            ->first();
    }

    private function cardDavSearchSourceKey(string $username, string $bookUri, string $cardUri): string
    {
        return $username.'|'.$bookUri.'|'.$cardUri;
    }
}
