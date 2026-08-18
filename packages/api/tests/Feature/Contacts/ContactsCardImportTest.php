<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Models\Addressbook;
use App\Models\Card;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class ContactsCardImportTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_import_multi_vcard_file_creates_all_contacts(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
UID:urn:uuid:11111111-1111-4111-8111-111111111111
EMAIL:jane@example.com
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Joe Example
UID:urn:uuid:22222222-2222-4222-8222-222222222222
EMAIL:joe@example.com
END:VCARD
VCARD;

        $response = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );

        $response->assertCreated()
            ->assertJsonCount(2, 'list')
            ->assertJsonCount(0, 'errors')
            ->assertJsonPath('list.0.name.full', 'Jane Doe')
            ->assertJsonPath('list.1.name.full', 'Joe Example');
    }

    public function test_import_group_after_members_creates_group_with_member_card_ids(): void
    {
        $vcard = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:07d442ce-49b5-4a59-bc01-d75b17b92c9a
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Friends
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:c4cf6038-5da0-41be-9c2d-d8cb9b4af90f
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:07d442ce-49b5-4a59-bc01-d75b17b92c9a
UID:08430ef3-a2ce-4568-9d6c-f50a6cfd32ae
END:VCARD
VCARD;

        $response = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );

        $response->assertCreated()
            ->assertJsonCount(3, 'list')
            ->assertJsonCount(0, 'errors');

        $group = collect($response->json('list'))
            ->first(fn (array $card): bool => ($card['kind'] ?? null) === 'group');

        $this->assertIsArray($group);
        $this->assertSame('Friends', $group['name']['full'] ?? null);
        $this->assertArrayHasKey('memberCardIds', $group);
    }

    public function test_import_apple_addressbook_group_with_kind_and_member_properties(): void
    {
        $janeUid = 'b0273eb1-df19-4f11-8446-85ee29cd9dfd';
        $joeUid = 'a9c0941e-ddf9-4c98-a1da-ee1b241a7e2d';

        $vcard = <<<VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:{$janeUid}
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:{$joeUid}
END:VCARD
BEGIN:VCARD
VERSION:3.0
UID:786ec7b4-e5c5-4977-af48-1aa1675bc135
KIND:group
X-ADDRESSBOOKSERVER-KIND:group
PRODID:-//Apple Inc.//AddressBookCore 1.0//EN
FN:Family Members
N:Family Members;;;;;;
MEMBER:urn:uuid:{$janeUid}
MEMBER:urn:uuid:{$joeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$janeUid}
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:{$joeUid}
END:VCARD
VCARD;

        $import = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );

        $import->assertCreated()
            ->assertJsonCount(3, 'list')
            ->assertJsonCount(0, 'errors');

        $group = collect($import->json('list'))
            ->first(fn (array $card): bool => ($card['kind'] ?? null) === 'group');
        $this->assertIsArray($group);
        $this->assertSame('Family Members', $group['name']['full'] ?? null);
        $this->assertCount(2, $group['members'] ?? []);
        $this->assertArrayHasKey('urn:uuid:'.$janeUid, $group['members']);
        $this->assertArrayHasKey('urn:uuid:'.$joeUid, $group['members']);

        $janeId = collect($import->json('list'))
            ->first(fn (array $card): bool => ($card['uid'] ?? null) === $janeUid)['id'] ?? null;
        $joeId = collect($import->json('list'))
            ->first(fn (array $card): bool => ($card['uid'] ?? null) === $joeUid)['id'] ?? null;
        $this->assertIsString($janeId);
        $this->assertIsString($joeId);
        $this->assertSame($janeId, $group['memberCardIds']['urn:uuid:'.$janeUid] ?? null);
        $this->assertSame($joeId, $group['memberCardIds']['urn:uuid:'.$joeUid] ?? null);

        $groupId = (string) $group['id'];
        $list = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $listedGroup = collect($list)
            ->first(fn (array $card): bool => ($card['id'] ?? null) === $groupId);
        $this->assertIsArray($listedGroup);
        $this->assertCount(2, $listedGroup['members'] ?? []);
        $this->assertSame($janeId, $listedGroup['memberCardIds']['urn:uuid:'.$janeUid] ?? null);

        $stored = $this->findBobCard($groupId);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('MEMBER:urn:uuid:'.$janeUid, $raw);
        $this->assertStringContainsString('X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:'.$joeUid, $raw);
    }

    public function test_import_apple_fixture_resolves_members_after_batch(): void
    {
        $vcard = (string) file_get_contents(__DIR__.'/../../fixtures/Contacts/apple-group-with-members.vcf');

        $response = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );

        $response->assertCreated()
            ->assertJsonCount(3, 'list')
            ->assertJsonCount(0, 'errors');

        $group = collect($response->json('list'))
            ->first(fn (array $card): bool => ($card['kind'] ?? null) === 'group');
        $this->assertIsArray($group);
        $this->assertCount(2, $group['members'] ?? []);
        $this->assertCount(2, $group['memberCardIds'] ?? []);
    }

    public function test_import_group_file_after_contacts_file_resolves_member_card_ids(): void
    {
        $contacts = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
UID:a1111111-1111-4111-8111-111111111111
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Joe Example
UID:a2222222-2222-4222-8222-222222222222
END:VCARD
VCARD;

        $group = <<<'VCARD'
BEGIN:VCARD
VERSION:3.0
UID:b3333333-3333-4333-8333-333333333333
KIND:group
X-ADDRESSBOOKSERVER-KIND:group
FN:Family Members
MEMBER:urn:uuid:a1111111-1111-4111-8111-111111111111
MEMBER:urn:uuid:a2222222-2222-4222-8222-222222222222
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:a1111111-1111-4111-8111-111111111111
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:a2222222-2222-4222-8222-222222222222
END:VCARD
VCARD;

        $headers = [
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
            'CONTENT_TYPE' => 'text/vcard',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $this->call('POST', '/api/v1/contacts/cards/import?addressBookId=default', [], [], [], $headers, $contacts)
            ->assertCreated()
            ->assertJsonCount(2, 'list');

        $groupImport = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            $headers,
            $group,
        );

        $groupImport->assertCreated()->assertJsonCount(1, 'list');
        $importedGroup = $groupImport->json('list.0');
        $this->assertIsArray($importedGroup);
        $this->assertSame('group', $importedGroup['kind'] ?? null);
        $this->assertCount(2, $importedGroup['memberCardIds'] ?? []);
    }

    public function test_import_empty_body_returns_bad_request(): void
    {
        $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            '',
        )
            ->assertStatus(400);
    }

    public function test_import_apple_vcard3_binary_photo_persists_media_and_blob(): void
    {
        $vcard = (string) file_get_contents(__DIR__.'/../../fixtures/Contacts/thomas-boo-photo.vcf');

        $response = $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );

        $response->assertCreated()
            ->assertJsonCount(1, 'list')
            ->assertJsonCount(0, 'errors')
            ->assertJsonPath('list.0.name.full', 'Thomas Boo');

        $card = $response->json('list.0');
        $this->assertIsArray($card);
        $media = $card['media'] ?? [];
        $this->assertNotEmpty($media, 'Imported card must expose photo media.');
        $entry = reset($media);
        $this->assertIsArray($entry);
        $this->assertSame('photo', $entry['kind'] ?? null);
        $this->assertArrayHasKey('blobId', $entry);
        $this->assertArrayNotHasKey('uri', $entry);
        $this->assertSame('image/jpeg', $entry['mediaType'] ?? null);

        $blobId = (string) $entry['blobId'];
        $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/photo.jpg')
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');

        $stored = $this->findBobCard((string) $card['id']);
        $this->assertNotNull($stored);
        $raw = is_string($stored->carddata) ? $stored->carddata : (string) $stored->carddata;
        $this->assertStringContainsString('PHOTO', $raw);
        $this->assertStringContainsStringIgnoringCase('TYPE=JPEG', $raw);
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
}
