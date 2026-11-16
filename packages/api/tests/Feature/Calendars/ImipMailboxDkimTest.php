<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Models\CalendarReplyMailbox;
use App\Services\Calendars\HostIpResolver;
use App\Services\Calendars\Imip\Dkim\DkimResult;
use App\Services\Calendars\Imip\Dkim\DnsTxtResolver;
use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapTransport;
use App\Services\Calendars\Imip\ImipEndpointResolver;
use App\Services\Calendars\Imip\ImipMailboxPoller;
use App\Services\Calendars\Imip\ImipMailboxSettings;
use App\Services\Calendars\Imip\ImipReplyIngest;
use App\Services\Calendars\Imip\ImipSenderVerifier;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeDnsTxtResolver;
use Tests\Support\FakeImapServer;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Replies from mailboxes whose receiving server stamps no
 * Authentication-Results header (#1589): the poller verifies DKIM itself.
 * Messages are signed by dkimpy (`tests/fixtures/Calendars/Dkim/`); DNS is
 * a fake, never the network.
 */
final class ImipMailboxDkimTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const UID = 'imip-poll-event-1';

    /** One minute after the fixtures were signed. */
    private const NOW = 1_900_000_060;

    private FakeImapServer $server;

    private FakeDnsTxtResolver $dns;

    /** @var list<array{message: string, context: array<string, mixed>}> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
        $this->seedEventViaPdo('bob', 'poll.ics', $this->organizerIcs());
        $this->server = new FakeImapServer(login: 'bob@example.test', password: 'mailbox-pass');
        $this->app->instance(ImapTransport::class, $this->server);
        $this->dns = FakeDnsTxtResolver::fixtures();
        $this->app->instance(DnsTxtResolver::class, $this->dns);
        $this->app->instance(ImipEndpointResolver::class, new class(new HostIpResolver) extends ImipEndpointResolver
        {
            public function resolve(string $host, int $port, string $security): ImapEndpoint
            {
                return new ImapEndpoint($host, '192.0.2.10', $port, $security);
            }
        });
    }

    public function test_dkim_signed_reply_is_applied_without_a_receiving_server(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('ACCEPTED', $this->guestStatus());
        $fresh = $mailbox->fresh();
        $this->assertSame(2, $fresh?->last_uid);
        $this->assertNull($fresh?->last_error_code);
        $this->assertSame(['rsa2048._domainkey.elsewhere.test'], $this->dns->queries);
        $this->assertContains('UID FETCH 2 (UID BODY.PEEK[])', $this->server->verbs());
    }

    public function test_ed25519_signed_reply_is_applied(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-ed25519.eml');

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('ACCEPTED', $this->guestStatus());
    }

    public function test_unsigned_reply_is_not_applied(): void
    {
        $mailbox = $this->connect();
        $unsigned = $this->signed('reply-rsa-relaxed.eml');
        $unsigned['headers'] = (string) preg_replace('/^DKIM-Signature:.*?\r\n(?=\S)/s', '', $unsigned['headers']);
        $this->server->messages[2] = $unsigned;

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
        $this->assertNotContains('UID FETCH 2 (UID BODY.PEEK[])', $this->server->verbs());
        $this->assertSame([], $this->dns->queries);
    }

    public function test_reply_signed_only_by_another_domain_is_not_applied(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-unaligned.eml');

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame([], $this->dns->queries);
    }

    public function test_tampered_reply_is_not_applied(): void
    {
        $mailbox = $this->connect();
        $tampered = $this->signed('reply-rsa-relaxed.eml');
        $tampered['raw'] = str_replace('has accepted', 'has declined', $tampered['raw']);
        $this->server->messages[2] = $tampered;
        $this->recordLogs();

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
        $this->assertSkippedWith(DkimResult::BODY_HASH);
    }

    public function test_reply_signed_more_than_72_hours_ago_is_not_applied(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');
        $this->recordLogs();

        $this->poller()->poll($mailbox, 1_900_000_000 + ImipSenderVerifier::FRESH_SECONDS + 60);

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSkippedWith(ImipSenderVerifier::STALE);
    }

    public function test_a_copy_of_an_applied_reply_is_refused(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');
        $this->server->messages[3] = $this->signed('reply-rsa-relaxed.eml');
        $this->recordLogs();

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('ACCEPTED', $this->guestStatus());
        $this->assertSame(3, $mailbox->fresh()?->last_uid);
        $this->assertSkippedWith(ImipSenderVerifier::REPLAYED);
    }

    public function test_dns_failure_defers_and_the_next_poll_applies(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');
        $this->server->messages[3] = $this->plainMessage();
        $key = $this->dns->records['rsa2048._domainkey.elsewhere.test'];
        $this->dns->records['rsa2048._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;

        $this->poller()->poll($mailbox, self::NOW);

        $fresh = $mailbox->fresh();
        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(1, $fresh?->last_uid, 'the cursor waits before the deferred reply, and later mail waits too');
        $this->assertSame(ImipMailboxPoller::DNS_UNAVAILABLE, $fresh?->last_error_code);

        $this->dns->records['rsa2048._domainkey.elsewhere.test'] = $key;
        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::MIN_INTERVAL_SECONDS);

        $fresh = $mailbox->fresh();
        $this->assertSame('ACCEPTED', $this->guestStatus());
        $this->assertSame(3, $fresh?->last_uid);
        $this->assertNull($fresh?->last_error_code);
    }

    public function test_a_reply_whose_key_cannot_be_looked_up_for_an_hour_is_skipped(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');
        $this->dns->records['rsa2048._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;

        $this->poller()->poll($mailbox, self::NOW);
        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::DNS_RETRY_SECONDS - 1);
        $this->assertSame(1, $mailbox->fresh()?->last_uid);

        $this->recordLogs();
        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::DNS_RETRY_SECONDS);

        $fresh = $mailbox->fresh();
        $this->assertSame(2, $fresh?->last_uid);
        $this->assertNull($fresh?->last_error_code);
        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSkippedWith(DkimResult::DNS_UNAVAILABLE);
    }

    public function test_failing_lookups_hold_the_mailbox_for_one_hour_in_total(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->withSelector($this->signed('reply-rsa-relaxed.eml'), 'bad1');
        $this->server->messages[3] = $this->withSelector($this->signed('reply-rsa-simple-length.eml'), 'bad2');
        $this->server->messages[4] = $this->signed('reply-ed25519.eml');
        $this->dns->records['bad1._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;
        $this->dns->records['bad2._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;

        $this->poller()->poll($mailbox, self::NOW);
        $this->assertSame(1, $mailbox->fresh()?->last_uid);

        $this->recordLogs();
        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::DNS_RETRY_SECONDS);

        $fresh = $mailbox->fresh();
        $this->assertSame(4, $fresh?->last_uid);
        $this->assertNull($fresh?->last_error_code);
        $this->assertSame('ACCEPTED', $this->guestStatus());
        $skipped = array_filter($this->logged, static fn (array $line): bool => $line['message'] === ImipReplyIngest::LOG_SKIPPED
            && ($line['context']['detail'] ?? null) === DkimResult::DNS_UNAVAILABLE);
        $this->assertSame([2, 3], array_values(array_map(static fn (array $line): int => $line['context']['imap_uid'], $skipped)));
    }

    public function test_a_truncated_batch_keeps_the_mailbox_dns_clock(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->withSelector($this->signed('reply-rsa-relaxed.eml'), 'bad1');
        for ($uid = 3; $uid <= 51; $uid++) {
            $this->server->messages[$uid] = $this->plainMessage();
        }
        $this->server->messages[52] = $this->withSelector($this->signed('reply-rsa-simple-length.eml'), 'bad2');
        $this->server->messages[53] = $this->signed('reply-ed25519.eml');
        $this->dns->records['bad1._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;
        $this->dns->records['bad2._domainkey.elsewhere.test'] = FakeDnsTxtResolver::FAIL;

        $this->poller()->poll($mailbox, self::NOW);
        $this->assertSame(1, $mailbox->fresh()?->last_uid);

        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::DNS_RETRY_SECONDS);
        $this->assertSame(51, $mailbox->fresh()?->last_uid);

        $this->recordLogs();
        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::DNS_RETRY_SECONDS + ImipMailboxPoller::MIN_INTERVAL_SECONDS);

        $this->assertSame(53, $mailbox->fresh()?->last_uid);
        $this->assertSame('ACCEPTED', $this->guestStatus());
        $skipped = array_filter($this->logged, static fn (array $line): bool => $line['message'] === ImipReplyIngest::LOG_SKIPPED
            && ($line['context']['detail'] ?? null) === DkimResult::DNS_UNAVAILABLE);
        $this->assertSame([52], array_values(array_map(static fn (array $line): int => $line['context']['imap_uid'], $skipped)));
    }

    public function test_a_dropped_connection_after_the_dkim_check_does_not_burn_the_signature(): void
    {
        $mailbox = $this->connect();
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');
        $this->server->byeOnSections = 1;

        $this->poller()->poll($mailbox, self::NOW);

        $fresh = $mailbox->fresh();
        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(1, $fresh?->last_uid);

        $this->poller()->poll($mailbox->refresh(), self::NOW + ImipMailboxPoller::MIN_INTERVAL_SECONDS);

        $this->assertSame('ACCEPTED', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
    }

    public function test_trusted_server_refusal_is_not_overridden_by_dkim(): void
    {
        $mailbox = $this->connect(trusted: 'mx.receiver.test');
        $this->server->messages[2] = $this->signed('reply-rsa-relaxed.eml');

        $this->poller()->poll($mailbox, self::NOW);

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertNotContains('UID FETCH 2 (UID BODY.PEEK[])', $this->server->verbs());
        $this->assertSame([], $this->dns->queries);
    }

    private function recordLogs(): void
    {
        Log::listen(function (MessageLogged $event): void {
            $this->logged[] = ['message' => $event->message, 'context' => $event->context];
        });
    }

    private function assertSkippedWith(string $detail): void
    {
        $matches = array_filter($this->logged, static fn (array $line): bool => $line['message'] === ImipReplyIngest::LOG_SKIPPED
            && ($line['context']['reason'] ?? null) === ImipReplyIngest::SENDER_NOT_VERIFIED
            && ($line['context']['detail'] ?? null) === $detail
            && ($line['context']['check'] ?? null) === 'dkim');
        $this->assertCount(1, $matches, 'one skip logged with '.$detail);
    }

    private function connect(string $trusted = ''): CalendarReplyMailbox
    {
        $this->server->messages = [1 => $this->plainMessage()];

        return $this->app->make(ImipMailboxSettings::class)->save('bob', [
            'host' => 'imap.example.test',
            'port' => 993,
            'security' => 'ssl',
            'login' => 'bob@example.test',
            'folder' => 'INBOX',
        ], 'mailbox-pass', [
            'trustedServerId' => $trusted,
            'uidValidity' => $this->server->uidValidity,
            'highestUid' => 1,
        ]);
    }

    private function poller(): ImipMailboxPoller
    {
        return $this->app->make(ImipMailboxPoller::class);
    }

    /**
     * A dkimpy-signed fixture as the fake server serves it: its header
     * block, the whole message, and the calendar part at section 1.2.
     *
     * @return array{size: int, headers: string, structure: string, sections: array<string, string>, raw: string}
     */
    private function signed(string $file): array
    {
        $raw = (string) file_get_contents(dirname(__DIR__, 2).'/fixtures/Calendars/Dkim/'.$file);
        $split = (int) strpos($raw, "\r\n\r\n");
        preg_match('/method=REPLY\r\nContent-Transfer-Encoding: base64\r\n\r\n(.*?)--b2--/s', $raw, $match);
        $calendar = $match[1] ?? '';

        return [
            'size' => strlen($raw),
            'headers' => substr($raw, 0, $split + 4),
            'structure' => '((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 44 2 NIL NIL NIL NIL)'
                .'("TEXT" "CALENDAR" ("CHARSET" "UTF-8" "METHOD" "REPLY") NIL NIL "BASE64" '.strlen($calendar).' 8 NIL NIL NIL NIL)'
                .' "ALTERNATIVE" ("BOUNDARY" "b2") NIL NIL NIL)'
                .'("APPLICATION" "ICS" ("NAME" "invite.ics") NIL NIL "BASE64" '.strlen($calendar).' NIL ("ATTACHMENT" ("FILENAME" "invite.ics")) NIL NIL)'
                .' "MIXED" ("BOUNDARY" "b1") NIL NIL NIL)',
            'sections' => ['1.2' => $calendar],
            'raw' => $raw,
        ];
    }

    /**
     * The same message naming another selector (the signature no longer
     * verifies, but its key is looked up first).
     *
     * @param  array{size: int, headers: string, structure: string, sections: array<string, string>, raw: string}  $message
     * @return array{size: int, headers: string, structure: string, sections: array<string, string>, raw: string}
     */
    private function withSelector(array $message, string $selector): array
    {
        $message['headers'] = str_replace('s=rsa2048;', 's='.$selector.';', $message['headers']);
        $message['raw'] = str_replace('s=rsa2048;', 's='.$selector.';', $message['raw']);

        return $message;
    }

    /** @return array{size: int, headers: string, structure: string} */
    private function plainMessage(): array
    {
        return [
            'size' => 900,
            'headers' => "From: Someone <someone@elsewhere.test>\r\nMessage-ID: <plain@elsewhere.test>\r\n\r\n",
            'structure' => '("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 120 4 NIL NIL NIL NIL)',
        ];
    }

    private function organizerIcs(): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\nBEGIN:VEVENT\r\nUID:".self::UID."\r\n"
            ."DTSTAMP:20300101T000000Z\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\n"
            ."SUMMARY:Planning\r\nORGANIZER;CN=Bob:mailto:bob@example.test\r\n"
            ."ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.test\r\n"
            ."ATTENDEE;CN=Guest;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@elsewhere.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function guestStatus(): string
    {
        $calendar = Reader::read((string) CalendarObject::query()->where('uid', self::UID)->value('calendardata'));
        foreach ($calendar->VEVENT->select('ATTENDEE') as $attendee) {
            if (strtolower((string) $attendee) === 'mailto:guest@elsewhere.test') {
                return strtoupper((string) $attendee['PARTSTAT']);
            }
        }

        return '';
    }
}
