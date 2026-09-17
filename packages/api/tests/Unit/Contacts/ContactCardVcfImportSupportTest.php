<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\Conversion\ContactCardVcfImportSupport;
use PHPUnit\Framework\TestCase;

final class ContactCardVcfImportSupportTest extends TestCase
{
    public function test_split_vcards_returns_multiple_blocks(): void
    {
        $input = <<<'VCARD'
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
UID:urn:uuid:11111111-1111-4111-8111-111111111111
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Joe Example
UID:urn:uuid:22222222-2222-4222-8222-222222222222
END:VCARD
VCARD;

        $blocks = ContactCardVcfImportSupport::splitVcards($input);

        $this->assertCount(2, $blocks);
        $this->assertStringContainsString('FN:Jane Doe', $blocks[0]);
        $this->assertStringContainsString('FN:Joe Example', $blocks[1]);
    }

    public function test_split_vcards_ignores_invalid_blocks(): void
    {
        $blocks = ContactCardVcfImportSupport::splitVcards("BEGIN:VCARD\nFN:Broken\n");

        $this->assertSame([], $blocks);
    }

    public function test_split_vcards_skips_prelude_and_leftover_tail(): void
    {
        $input = <<<'VCARD'
# exported from Apple Contacts
BEGIN:VCARD
VERSION:4.0
FN:Jane Doe
END:VCARD
END:VCARD
BEGIN:VCARD
END:VCARD
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//AddressBook
END:VCARD
# footer
BEGIN:VCARD
FN:Truncated
VCARD;

        $blocks = ContactCardVcfImportSupport::splitVcards($input);

        $this->assertCount(1, $blocks);
        $this->assertStringContainsString('FN:Jane Doe', $blocks[0]);
    }

    public function test_split_vcards_empty_body_is_not_an_invalid_block(): void
    {
        $this->assertSame([], ContactCardVcfImportSupport::splitVcards(''));
        $this->assertSame([], ContactCardVcfImportSupport::splitVcards("   \n"));
        $this->assertSame([], ContactCardVcfImportSupport::splitVcards("# prelude only\nEND:VCARD\n"));
    }

    public function test_is_group_card_detects_kind_and_members(): void
    {
        $this->assertTrue(ContactCardVcfImportSupport::isGroupCard([
            'kind' => 'group',
            'name' => ['full' => 'Friends'],
        ]));
        $this->assertTrue(ContactCardVcfImportSupport::isGroupCard([
            'members' => ['urn:uuid:member-1' => true],
        ]));
        $this->assertFalse(ContactCardVcfImportSupport::isGroupCard([
            'kind' => 'individual',
            'name' => ['full' => 'Jane Doe'],
        ]));
    }

    public function test_create_payload_sets_address_book_and_strips_server_fields(): void
    {
        $payload = ContactCardVcfImportSupport::createPayload([
            'id' => 'card-1',
            'etag' => '"etag"',
            'memberCardIds' => ['urn:uuid:member-1' => 'card-member'],
            'uid' => 'urn:uuid:contact-1',
            'name' => ['full' => 'Jane Doe'],
        ], 'default');

        $this->assertSame(['default' => true], $payload['addressBookIds']);
        $this->assertArrayNotHasKey('id', $payload);
        $this->assertArrayNotHasKey('etag', $payload);
        $this->assertArrayNotHasKey('memberCardIds', $payload);
        $this->assertSame('urn:uuid:contact-1', $payload['uid']);
    }
}
