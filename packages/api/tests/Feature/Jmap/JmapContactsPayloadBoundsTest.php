<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Payload-bound twins for contacts (JMAP set/get + import island via REST).
 */
final class JmapContactsPayloadBoundsTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_oversized_contact_create_is_too_large(): void
    {
        $note = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);

        $response = $this->jmapContacts([
            ['ContactCard/set', [
                'accountId' => 'bob',
                'create' => ['k0' => [
                    'addressBookIds' => ['default' => true],
                    'name' => ['full' => 'Oversized Contact'],
                    'notes' => [
                        '550e8400-e29b-41d4-a716-446655440099' => ['note' => $note],
                    ],
                ]],
            ], 'c0'],
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.created.k0'));
        $this->assertSame('tooLarge', $response->json('methodResponses.0.1.notCreated.k0.type'));
        $this->assertStringContainsString(
            (string) VObjectPayloadGuard::MAX_VCARD_BYTES,
            (string) $response->json('methodResponses.0.1.notCreated.k0.description'),
        );
        $this->assertSame([], $response->json('methodResponses.1.1.list'));
    }

    public function test_oversized_stored_contact_read_is_not_found(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Huge\r\nNOTE:{$padding}\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'huge-card.vcf', $vcard);

        $response = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c0'],
        ])->assertOk();

        $this->assertSame('ContactCard/get', $response->json('methodResponses.0.0'));
        $this->assertSame([], $response->json('methodResponses.0.1.list'));
        $this->assertSame([$cardId], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_contact_import_body_over_configured_cap_returns_payload_too_large(): void
    {
        config(['wgw.contacts.import_max_bytes' => 64 * 1024]);
        $body = str_repeat('A', (64 * 1024) + 1);

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
            $body,
        )
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_contact_import_oversized_card_is_per_item_error_siblings_import(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);
        $vcard = <<<VCARD
BEGIN:VCARD
VERSION:4.0
FN:Ok Sibling
UID:urn:uuid:11111111-1111-4111-8111-111111111111
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Huge
UID:urn:uuid:22222222-2222-4222-8222-222222222222
NOTE:{$padding}
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Also Ok
UID:urn:uuid:33333333-3333-4333-8333-333333333333
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
        )->assertCreated();

        $this->assertCount(2, $response->json('list'));
        $this->assertCount(1, $response->json('errors'));
        $this->assertSame('payload_too_large', $response->json('errors.0.code'));
        $this->assertStringContainsString(
            (string) VObjectPayloadGuard::MAX_VCARD_BYTES,
            (string) $response->json('errors.0.message'),
        );
    }
}
