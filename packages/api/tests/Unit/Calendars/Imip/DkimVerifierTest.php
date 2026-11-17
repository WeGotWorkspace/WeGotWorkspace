<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\Dkim\DkimCanonicalizer;
use App\Services\Calendars\Imip\Dkim\DkimKeyStore;
use App\Services\Calendars\Imip\Dkim\DkimResult;
use App\Services\Calendars\Imip\Dkim\DkimVerifier;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tests\Support\DkimTestSigner;
use Tests\Support\FakeDnsTxtResolver;

/**
 * DKIM verification (RFC 6376, RFC 8301, RFC 8463) for iMIP replies (#1589).
 * Interoperability: RFC 8463's example and messages signed by dkimpy.
 * Rules: messages signed per test by {@see DkimTestSigner}.
 */
final class DkimVerifierTest extends TestCase
{
    private const FIXTURE_TIME = 1_900_000_060;

    private const NOW = 1_800_000_000;

    private FakeDnsTxtResolver $dns;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = FakeDnsTxtResolver::fixtures();
        $this->dns->records['t1._domainkey.elsewhere.test'] = ['v=DKIM1; k=rsa; p='.DkimTestSigner::rsaPublic()];
        $this->dns->records['ed._domainkey.elsewhere.test'] = ['v=DKIM1; k=ed25519; p='.DkimTestSigner::ed25519Public()];
    }

    /** @return array<string, array{string, string}> */
    public static function rfc8463Signatures(): array
    {
        return ['ed25519-sha256' => ['ed25519-sha256', 'brisbane'], 'rsa-sha256' => ['rsa-sha256', 'test']];
    }

    #[DataProvider('rfc8463Signatures')]
    public function test_rfc8463_example_verifies(string $algorithm, string $selector): void
    {
        $message = $this->onlySignature($this->fixture('rfc8463-football.eml'), $algorithm);

        $result = $this->verify($message, 1_528_637_909);

        $this->assertSame(DkimResult::PASS, $result->status, $result->reason);
        $this->assertSame('football.example.com', $result->domain);
        $this->assertSame(1_528_637_909, $result->signedAt);
        $this->assertSame([$selector.'._domainkey.football.example.com'], $this->dns->queries);
    }

    /** @return array<string, array{string, string}> */
    public static function dkimpyFixtures(): array
    {
        return [
            'rsa relaxed/relaxed' => ['reply-rsa-relaxed.eml', 'elsewhere.test'],
            'rsa simple/simple with l=' => ['reply-rsa-simple-length.eml', 'elsewhere.test'],
            'ed25519 relaxed/simple' => ['reply-ed25519.eml', 'elsewhere.test'],
            'rsa by a relay domain' => ['reply-unaligned.eml', 'mailer-relay.test'],
        ];
    }

    #[DataProvider('dkimpyFixtures')]
    public function test_messages_signed_by_dkimpy_verify(string $file, string $domain): void
    {
        $result = $this->verify($this->fixture($file));

        $this->assertSame(DkimResult::PASS, $result->status, $result->reason);
        $this->assertSame($domain, $result->domain);
        $this->assertSame(1_900_000_000, $result->signedAt);
    }

    public function test_bare_line_feeds_are_read_as_crlf(): void
    {
        $message = str_replace("\r\n", "\n", $this->fixture('reply-rsa-relaxed.eml'));

        $this->assertTrue($this->verify($message)->passed());
    }

    public function test_a_changed_signed_header_fails(): void
    {
        $rsa = str_replace('Subject: Accepted:', 'Subject: Declined:', $this->fixture('reply-rsa-relaxed.eml'));
        $ed = str_replace('Subject: Accepted:', 'Subject: Declined:', $this->fixture('reply-ed25519.eml'));

        $this->assertFailed(DkimResult::SIGNATURE, $this->verify($rsa));
        $this->assertFailed(DkimResult::SIGNATURE, $this->verify($ed));
    }

    public function test_a_changed_body_fails(): void
    {
        $message = str_replace('has accepted', 'has declined', $this->fixture('reply-ed25519.eml'));

        $this->assertFailed(DkimResult::BODY_HASH, $this->verify($message));
    }

    public function test_relaxed_headers_survive_refolding_and_simple_ones_do_not(): void
    {
        $relaxed = str_replace('Subject: Accepted: Planning', "Subject:  Accepted:\r\n\tPlanning", $this->fixture('reply-rsa-relaxed.eml'));
        $simple = str_replace('Subject: Accepted: Planning', "Subject:  Accepted:\r\n\tPlanning", $this->fixture('reply-rsa-simple-length.eml'));

        $this->assertTrue($this->verify($relaxed)->passed());
        $this->assertFailed(DkimResult::SIGNATURE, $this->verify($simple));
    }

    public function test_nothing_can_be_appended_after_a_signed_body_length(): void
    {
        $message = $this->fixture('reply-rsa-simple-length.eml')."--b1\r\nContent-Type: text/calendar; method=REPLY\r\n\r\nBEGIN:VCALENDAR\r\n";

        $this->assertFailed(DkimResult::PARTIAL_BODY, $this->verify($message));
    }

    public function test_a_body_length_shorter_than_the_body_fails(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['l' => '4']);

        $this->assertFailed(DkimResult::PARTIAL_BODY, $this->verify($message, self::NOW));
    }

    public function test_a_test_signed_message_passes(): void
    {
        $rsa = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['t' => (string) self::NOW]);
        $ed = DkimTestSigner::sign($this->message(), 'elsewhere.test', 'ed', ['a' => 'ed25519-sha256', 'c' => 'simple/relaxed']);

        $this->assertTrue($this->verify($rsa, self::NOW)->passed());
        $this->assertTrue($this->verify($ed, self::NOW)->passed());
    }

    public function test_an_expired_signature_fails(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['t' => (string) (self::NOW - 100), 'x' => (string) (self::NOW - 1)]);

        $this->assertFailed(DkimResult::EXPIRED, $this->verify($message, self::NOW));
    }

    public function test_an_expiry_before_the_signing_time_is_malformed(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['t' => (string) self::NOW, 'x' => (string) self::NOW]);

        $this->assertFailed(DkimResult::MALFORMED, $this->verify($message, self::NOW));
    }

    public function test_rsa_sha1_fails(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['a' => 'rsa-sha1']);

        $this->assertFailed(DkimResult::ALGORITHM, $this->verify($message, self::NOW));
        $this->assertSame([], $this->dns->queries);
    }

    public function test_an_rsa_key_under_1024_bits_fails(): void
    {
        $this->dns->records['weak._domainkey.elsewhere.test'] = ['v=DKIM1; p='.DkimTestSigner::rsaPublic(512)];
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 'weak', rsaBits: 512);

        $this->assertFailed(DkimResult::KEY_INVALID, $this->verify($message, self::NOW));
    }

    /** @return array<string, array{string, string}> */
    public static function unusableKeys(): array
    {
        return [
            'revoked' => ['v=DKIM1; k=rsa; p=', DkimResult::KEY_REVOKED],
            'testing' => ['v=DKIM1; t=y; p=KEY', DkimResult::KEY_TESTING],
            'wrong type' => ['v=DKIM1; k=ed25519; p=KEY', DkimResult::KEY_INVALID],
            'sha1 only' => ['v=DKIM1; h=sha1; p=KEY', DkimResult::KEY_INVALID],
            'not for email' => ['v=DKIM1; s=tlsrpt; p=KEY', DkimResult::KEY_INVALID],
            'strict with a subdomain identity' => ['v=DKIM1; t=s; p=KEY', DkimResult::KEY_INVALID],
            'two records' => ["v=DKIM1; p=KEY\nv=DKIM1; p=KEY", DkimResult::KEY_INVALID],
            'not a key' => ['v=spf1 -all', DkimResult::KEY_MISSING],
            'version not first' => ['p=KEY; v=DKIM1', DkimResult::KEY_MISSING],
        ];
    }

    #[DataProvider('unusableKeys')]
    public function test_unusable_key_records_fail(string $record, string $reason): void
    {
        $this->dns->records['t1._domainkey.elsewhere.test'] = explode("\n", str_replace('KEY', DkimTestSigner::rsaPublic(), $record));
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['i' => 'guest@mail.elsewhere.test']);

        $this->assertFailed($reason, $this->verify($message, self::NOW));
    }

    public function test_a_selector_without_a_key_fails(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 'gone');

        $this->assertFailed(DkimResult::KEY_MISSING, $this->verify($message, self::NOW));
    }

    public function test_a_failed_lookup_is_temporary(): void
    {
        $this->dns->records['t1._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1');

        $result = $this->verify($message, self::NOW);

        $this->assertSame(DkimResult::TEMPERROR, $result->status);
        $this->assertSame(DkimResult::DNS_UNAVAILABLE, $result->reason);
    }

    public function test_a_failed_lookup_does_not_matter_when_another_signature_passes(): void
    {
        $this->dns->records['down._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1');
        $message = DkimTestSigner::sign($message, 'elsewhere.test', 'down');

        $this->assertTrue($this->verify($message, self::NOW)->passed());
    }

    public function test_a_broken_signature_above_a_good_one_does_not_stop_it(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1');
        $message = DkimTestSigner::sign($message, 'elsewhere.test', 'gone');

        $this->assertTrue($this->verify($message, self::NOW)->passed());
    }

    public function test_a_signature_that_does_not_sign_from_is_malformed(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', headers: ['to', 'subject']);

        $this->assertFailed(DkimResult::MALFORMED, $this->verify($message, self::NOW));
    }

    public function test_an_identity_outside_the_signing_domain_is_malformed(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['i' => '@other.test']);

        $this->assertFailed(DkimResult::MALFORMED, $this->verify($message, self::NOW));
    }

    public function test_a_duplicate_tag_is_malformed(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['z' => 'x; s=t1']);

        $this->assertFailed(DkimResult::MALFORMED, $this->verify($message, self::NOW));
    }

    public function test_a_signature_by_a_domain_the_caller_refuses_is_not_looked_up(): void
    {
        $result = (new DkimVerifier($this->keys()))->verify(
            $this->fixture('reply-unaligned.eml'),
            static fn (string $domain): bool => $domain === 'elsewhere.test',
            self::FIXTURE_TIME,
        );

        $this->assertSame(DkimResult::NONE, $result->status);
        $this->assertSame(DkimResult::NO_SIGNATURE, $result->reason);
        $this->assertSame([], $this->dns->queries);
    }

    public function test_only_the_first_five_signatures_are_looked_at(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1');
        for ($i = 0; $i < DkimVerifier::MAX_SIGNATURES; $i++) {
            $message = DkimTestSigner::sign($message, 'elsewhere.test', 'gone'.$i);
        }

        $this->assertFailed(DkimResult::KEY_MISSING, $this->verify($message, self::NOW));
        $this->assertCount(DkimVerifier::MAX_SIGNATURES, $this->dns->queries);
    }

    public function test_the_signed_date_is_the_signing_time_without_t(): void
    {
        $message = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['t' => '']);
        $unsignedDate = DkimTestSigner::sign($this->message(), 'elsewhere.test', 't1', ['t' => ''], ['from', 'to']);

        $this->assertSame(strtotime('Sun, 17 Mar 2030 17:46:40 +0000'), $this->verify($message, self::NOW)->signedAt);
        $this->assertNull($this->verify($unsignedDate, self::NOW)->signedAt);
    }

    public function test_an_unreadable_message_is_malformed(): void
    {
        $this->assertFailed(DkimResult::MALFORMED, $this->verify("\r\nno header"));
        $this->assertSame(DkimResult::NONE, $this->verify($this->message())->status);
    }

    /** @return array<string, array{string, string, string}> */
    public static function bodies(): array
    {
        return [
            'empty' => ['', "\r\n", ''],
            'trailing empty lines' => ["a\r\n\r\n\r\n", "a\r\n", "a\r\n"],
            'no final line end' => ['a', "a\r\n", "a\r\n"],
            'whitespace' => ["a  \t b \r\n \r\n", "a  \t b \r\n \r\n", "a b\r\n"],
        ];
    }

    #[DataProvider('bodies')]
    public function test_body_canonicalization(string $body, string $simple, string $relaxed): void
    {
        $this->assertSame($simple, DkimCanonicalizer::body($body, DkimCanonicalizer::SIMPLE));
        $this->assertSame($relaxed, DkimCanonicalizer::body($body, DkimCanonicalizer::RELAXED));
    }

    public function test_header_canonicalization(): void
    {
        $raw = "SubJect \t:  Hello \r\n\t  world  \r\n";

        $this->assertSame($raw, DkimCanonicalizer::header($raw, DkimCanonicalizer::SIMPLE));
        $this->assertSame("subject:Hello world\r\n", DkimCanonicalizer::header($raw, DkimCanonicalizer::RELAXED));
    }

    private function verify(string $message, int $now = self::FIXTURE_TIME): DkimResult
    {
        return (new DkimVerifier($this->keys()))->verify($message, static fn (): bool => true, $now);
    }

    private function keys(): DkimKeyStore
    {
        return new DkimKeyStore($this->dns, new Repository(new ArrayStore));
    }

    private function assertFailed(string $reason, DkimResult $result): void
    {
        $this->assertSame(DkimResult::FAIL, $result->status, $result->reason);
        $this->assertSame($reason, $result->reason);
    }

    private function fixture(string $name): string
    {
        return (string) file_get_contents(dirname(__DIR__, 3).'/fixtures/Calendars/Dkim/'.$name);
    }

    private function message(): string
    {
        return "From: Guest <guest@elsewhere.test>\r\nTo: bob@example.test\r\nSubject: Accepted\r\n"
            ."Date: Sun, 17 Mar 2030 17:46:40 +0000\r\n\r\nGuest has accepted.\r\n";
    }

    /** RFC 8463's message with only the signature of one algorithm left. */
    private function onlySignature(string $message, string $algorithm): string
    {
        [$first, $second, $rest] = preg_split('/(?=^(?:DKIM-Signature|From):)/m', $message, 3, PREG_SPLIT_NO_EMPTY) ?: ['', '', ''];

        return (str_contains($first, 'a='.$algorithm) ? $first : $second).$rest;
    }
}
