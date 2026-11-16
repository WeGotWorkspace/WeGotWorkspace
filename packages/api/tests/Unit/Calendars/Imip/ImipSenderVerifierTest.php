<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\Dkim\DkimKeyStore;
use App\Services\Calendars\Imip\Dkim\DkimResult;
use App\Services\Calendars\Imip\Dkim\DkimVerifier;
use App\Services\Calendars\Imip\ImipSenderAuthentication;
use App\Services\Calendars\Imip\ImipSenderCheck;
use App\Services\Calendars\Imip\ImipSenderVerifier;
use App\Services\Calendars\Imip\MailHeaders;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tests\Support\FakeDnsTxtResolver;

/**
 * Which evidence authenticates a reply's sender (#1589): the trusted
 * receiving server's stamp when one is known, DKIM otherwise, with
 * alignment, freshness and replay rules.
 */
final class ImipSenderVerifierTest extends TestCase
{
    private const NOW = 1_900_000_060;

    private FakeDnsTxtResolver $dns;

    private Repository $cache;

    private int $fetches = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = FakeDnsTxtResolver::fixtures();
        $this->cache = new Repository(new ArrayStore);
    }

    public function test_a_signed_reply_is_verified_by_dkim(): void
    {
        $check = $this->check($this->fixture('reply-rsa-relaxed.eml'));

        $this->assertTrue($check->ok(), $check->reason);
        $this->assertSame('guest@elsewhere.test', $check->sender?->email);
        $this->assertSame(ImipSenderCheck::DKIM, $check->check);
        $this->assertSame(1, $this->fetches);
    }

    public function test_a_trusted_receiving_server_is_the_only_evidence_when_known(): void
    {
        $message = $this->fixture('reply-rsa-relaxed.eml');

        $check = $this->check($message, trusted: 'mx.receiver.test');

        $this->assertFalse($check->ok());
        $this->assertSame(ImipSenderCheck::RECEIVING_SERVER, $check->check);
        $this->assertSame(ImipSenderAuthentication::NO_RESULTS, $check->reason);
        $this->assertSame(0, $this->fetches, 'the whole message is not downloaded');
        $this->assertSame([], $this->dns->queries);
    }

    public function test_without_an_aligned_signature_the_message_is_not_downloaded(): void
    {
        $unsigned = "From: guest@elsewhere.test\r\nSubject: x\r\n\r\nbody\r\n";

        $this->assertRefused(DkimResult::NO_SIGNATURE, $this->check($unsigned));
        $this->assertRefused(DkimResult::NO_SIGNATURE, $this->check($this->fixture('reply-unaligned.eml')));
        $this->assertSame(0, $this->fetches);
        $this->assertSame([], $this->dns->queries);
    }

    /** @return array<string, array{string, string, bool}> */
    public static function alignment(): array
    {
        return [
            'same domain' => ['example.com', 'example.com', true],
            'signer is a parent' => ['example.com', 'mail.example.com', true],
            'signer is a subdomain' => ['mail.example.com', 'example.com', false],
            'signer is a top-level domain' => ['com', 'example.com', false],
            'look-alike suffix' => ['ample.com', 'example.com', false],
            'unrelated' => ['other.com', 'example.com', false],
            'empty' => ['', 'example.com', false],
        ];
    }

    #[DataProvider('alignment')]
    public function test_alignment(string $signer, string $from, bool $aligned): void
    {
        $this->assertSame($aligned, ImipSenderVerifier::aligned($signer, $from));
    }

    public function test_a_from_header_added_above_the_signed_one_is_refused(): void
    {
        $message = "From: Guest Person <guest@elsewhere.test>\r\n".$this->fixture('reply-rsa-relaxed.eml');

        $this->assertRefused(ImipSenderAuthentication::NO_SENDER, $this->check($message));
    }

    public function test_the_downloaded_message_must_name_the_same_sender(): void
    {
        $headers = MailHeaders::parse($this->headerBlock($this->fixture('reply-rsa-relaxed.eml')));
        $other = str_replace('guest@elsewhere.test>', 'boss@elsewhere.test>', $this->fixture('reply-rsa-relaxed.eml'));

        $check = $this->verifier()->check('bob', $headers, '', fn (): string => $other, self::NOW);

        $this->assertRefused(ImipSenderAuthentication::NO_SENDER, $check);
    }

    public function test_a_failed_key_lookup_defers(): void
    {
        $this->dns->records['rsa2048._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;

        $check = $this->check($this->fixture('reply-rsa-relaxed.eml'));

        $this->assertFalse($check->ok());
        $this->assertTrue($check->retry);
        $this->assertSame(DkimResult::DNS_UNAVAILABLE, $check->reason);
    }

    public function test_a_signature_older_than_72_hours_is_refused(): void
    {
        $message = $this->fixture('reply-ed25519.eml');

        $this->assertRefused(ImipSenderVerifier::STALE, $this->check($message, now: 1_900_000_000 + ImipSenderVerifier::FRESH_SECONDS + 1));
        $this->assertRefused(ImipSenderVerifier::STALE, $this->check($message, now: 1_900_000_000 - ImipSenderVerifier::CLOCK_SKEW_SECONDS - 1));
        $this->assertTrue($this->check($message, now: 1_900_000_000 + ImipSenderVerifier::FRESH_SECONDS)->ok());
    }

    public function test_the_same_signature_is_accepted_once_per_mailbox(): void
    {
        $message = $this->fixture('reply-rsa-relaxed.eml');

        $this->assertTrue($this->check($message)->ok());
        $this->assertRefused(ImipSenderVerifier::REPLAYED, $this->check($message));
        $this->assertTrue($this->check($message, owner: 'carol')->ok());
    }

    public function test_a_broken_signature_is_refused_with_its_reason(): void
    {
        $message = str_replace('has accepted', 'has declined', $this->fixture('reply-rsa-relaxed.eml'));

        $this->assertRefused(DkimResult::BODY_HASH, $this->check($message));
    }

    private function check(string $message, string $trusted = '', int $now = self::NOW, string $owner = 'bob'): ImipSenderCheck
    {
        $headers = MailHeaders::parse($this->headerBlock($message));

        return $this->verifier()->check($owner, $headers, $trusted, function () use ($message): string {
            $this->fetches++;

            return $message;
        }, $now);
    }

    private function verifier(): ImipSenderVerifier
    {
        return new ImipSenderVerifier(
            new ImipSenderAuthentication,
            new DkimVerifier(new DkimKeyStore($this->dns, $this->cache)),
            $this->cache,
        );
    }

    private function assertRefused(string $reason, ImipSenderCheck $check): void
    {
        $this->assertFalse($check->ok());
        $this->assertFalse($check->retry);
        $this->assertSame($reason, $check->reason);
    }

    private function headerBlock(string $message): string
    {
        return substr($message, 0, (int) strpos($message, "\r\n\r\n") + 4);
    }

    private function fixture(string $name): string
    {
        return (string) file_get_contents(dirname(__DIR__, 3).'/fixtures/Calendars/Dkim/'.$name);
    }
}
