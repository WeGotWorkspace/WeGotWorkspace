<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\Mail\MailStateCodec;
use PHPUnit\Framework\TestCase;

final class MailStateCodecTest extends TestCase
{
    public function test_empty_snapshot_round_trips(): void
    {
        $state = MailStateCodec::compose([]);

        $this->assertTrue(MailStateCodec::isValid($state));
        $this->assertSame([], MailStateCodec::parse($state));
    }

    public function test_mailbox_snapshot_round_trips_sorted_by_name(): void
    {
        $map = [
            'INBOX' => ['uidvalidity' => 9, 'uidnext' => 4, 'window' => 'abc'],
            'Drafts' => ['uidvalidity' => 2, 'uidnext' => 1, 'window' => 'def'],
        ];
        $state = MailStateCodec::compose($map);

        $this->assertTrue(str_starts_with($state, MailStateCodec::PREFIX));
        $parsed = MailStateCodec::parse($state);
        $this->assertNotNull($parsed);
        $this->assertSame(['Drafts', 'INBOX'], array_keys($parsed));
        $this->assertSame($map['INBOX'], $parsed['INBOX']);
        $this->assertSame($map['Drafts'], $parsed['Drafts']);
        $this->assertSame($state, MailStateCodec::compose($parsed));
    }

    public function test_legacy_hex_digest_is_valid_but_unparseable(): void
    {
        $legacy = MailStateCodec::PREFIX.str_repeat('a', 32);

        $this->assertTrue(MailStateCodec::isValid($legacy));
        $this->assertNull(MailStateCodec::parse($legacy));
    }

    public function test_malformed_states_are_rejected(): void
    {
        $this->assertFalse(MailStateCodec::isValid(''));
        $this->assertFalse(MailStateCodec::isValid('m2:abc'));
        $this->assertNull(MailStateCodec::parse(''));
        $this->assertNull(MailStateCodec::parse(MailStateCodec::PREFIX));
        $this->assertNull(MailStateCodec::parse(MailStateCodec::PREFIX.'@@@'));
    }
}
