<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Services\Contacts\CardUid;
use PHPUnit\Framework\TestCase;

final class CardUidTest extends TestCase
{
    public function test_normalize_strips_urn_prefix_and_lower_cases(): void
    {
        $this->assertSame('abc-123', CardUid::normalize('urn:uuid:ABC-123'));
        $this->assertSame('abc-123', CardUid::normalize('ABC-123'));
        $this->assertSame('abc-123', CardUid::normalize('  URN:UUID:abc-123 '));
        $this->assertNull(CardUid::normalize('   '));
    }

    public function test_normalize_hashes_a_uid_longer_than_the_column(): void
    {
        $long = str_repeat('x', CardUid::MAX_LENGTH + 1);

        $stored = CardUid::normalize($long);

        $this->assertSame('sha256:'.hash('sha256', $long), $stored);
        $this->assertLessThanOrEqual(CardUid::MAX_LENGTH, strlen((string) $stored));
        $this->assertSame($stored, CardUid::normalize(strtoupper($long)));
    }

    public function test_reads_the_uid_from_vcard_data(): void
    {
        $this->assertSame('urn:uuid:Abc', CardUid::rawFromCardData("BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:Abc\r\nFN:A\r\nEND:VCARD\r\n"));
        $this->assertSame('abc', CardUid::forCardData("BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:Abc\r\nFN:A\r\nEND:VCARD\r\n"));
        $this->assertNull(CardUid::forCardData("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEND:VCARD\r\n"));
        $this->assertSame('folded-uid', CardUid::forCardData("BEGIN:VCARD\r\nVERSION:4.0\r\nUID:folded\r\n -uid\r\nFN:A\r\nEND:VCARD\r\n"));
    }

    public function test_falls_back_to_the_raw_line_when_vobject_cannot_parse(): void
    {
        $this->assertSame('broken-uid', CardUid::forCardData("UID:Broken-UID\r\nnot a vcard at all"));
    }

    public function test_with_uid_changes_only_the_uid_line(): void
    {
        $card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:old\r\nFN:Keep  Spacing\r\nNOTE:line one\r\n  folded\r\nEND:VCARD\r\n";

        $this->assertSame(
            "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:urn:uuid:new\r\nFN:Keep  Spacing\r\nNOTE:line one\r\n  folded\r\nEND:VCARD\r\n",
            CardUid::withUid($card, 'urn:uuid:new'),
        );
    }

    public function test_with_uid_adds_a_missing_uid(): void
    {
        $this->assertSame(
            "BEGIN:VCARD\r\nUID:urn:uuid:new\r\nVERSION:3.0\r\nFN:A\r\nEND:VCARD\r\n",
            CardUid::withUid("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nEND:VCARD\r\n", 'urn:uuid:new'),
        );
    }

    public function test_with_uid_rewrites_a_folded_uid(): void
    {
        $rewritten = CardUid::withUid("BEGIN:VCARD\r\nVERSION:4.0\r\nUID:folded\r\n -uid\r\nFN:A\r\nEND:VCARD\r\n", 'urn:uuid:new');

        $this->assertNotNull($rewritten);
        $this->assertSame('urn:uuid:new', CardUid::rawFromCardData($rewritten));
        $this->assertStringContainsString('FN:A', $rewritten);
    }

    public function test_with_uid_refuses_data_that_is_no_vcard(): void
    {
        $this->assertNull(CardUid::withUid('plain text', 'urn:uuid:new'));
    }
}
