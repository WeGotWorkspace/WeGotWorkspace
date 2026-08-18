<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Payload-bound twins for contacts, extracted from JmapRestPayloadBoundsTest
 * before the dual-protocol card REST routes were removed.
 */
final class JmapContactsPayloadBoundsTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_oversized_contact_create_is_rejected(): void
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
        $this->assertIsArray($response->json('methodResponses.0.1.notCreated.k0'));
        $this->assertSame([], $response->json('methodResponses.1.1.list'));
    }

    public function test_oversized_stored_contact_read_is_rejected(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Huge\r\nNOTE:{$padding}\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'huge-card.vcf', $vcard);

        $response = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $this->assertContains(
            $response->json('methodResponses.0.1.type'),
            ['invalidArguments', 'serverFail'],
        );
    }
}
