<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Models\CalendarReplyMailbox;
use App\Services\Calendars\HostIpResolver;
use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapException;
use App\Services\Calendars\Imip\ImapTransport;
use App\Services\Calendars\Imip\ImipEndpointResolver;
use App\Services\Calendars\Imip\ImipMailboxPoller;
use App\Services\Calendars\Imip\ImipMailboxSettings;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeImapServer;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The scheduler side of reply ingest (#1589): cursor, read-only access,
 * size caps, errors, and the trusted receiving server.
 */
final class ImipMailboxPollTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const UID = 'imip-poll-event-1';

    private const TRUSTED = 'mx.receiver.test';

    private FakeImapServer $server;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
        $this->seedEventViaPdo('bob', 'poll.ics', $this->organizerIcs());
        $this->server = new FakeImapServer(login: 'bob@example.test', password: 'mailbox-pass');
        $this->app->instance(ImapTransport::class, $this->server);
        $this->app->instance(ImipEndpointResolver::class, new class(new HostIpResolver) extends ImipEndpointResolver
        {
            public function resolve(string $host, int $port, string $security): ImapEndpoint
            {
                return new ImapEndpoint($host, '192.0.2.10', $port, $security);
            }
        });
    }

    public function test_poll_without_mailboxes_does_nothing(): void
    {
        $this->assertSame(0, $this->poller()->pollDue());
        $this->assertSame(0, $this->server->opens);
    }

    public function test_first_poll_starts_after_mail_that_is_already_there(): void
    {
        $this->server->messages = [1 => $this->replyMessage(), 2 => $this->plainMessage()];
        $mailbox = $this->connect();

        $this->poller()->poll($mailbox);

        $this->assertSame(2, $mailbox->fresh()?->last_uid);
        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
    }

    public function test_new_reply_is_applied_and_the_cursor_moves(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);

        $this->server->messages[2] = $this->replyMessage();
        $this->poller()->poll($mailbox->refresh());

        $this->assertSame('ACCEPTED', $this->guestStatus());
        $fresh = $mailbox->fresh();
        $this->assertNotNull($fresh);
        $this->assertSame(2, $fresh->last_uid);
        $this->assertNull($fresh->last_error_code);
        $this->assertNotNull($fresh->last_success_at);
    }

    public function test_mailbox_is_opened_read_only(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);
        $this->server->messages[2] = $this->replyMessage();
        $this->poller()->poll($mailbox->refresh());

        $verbs = $this->server->verbs();
        $this->assertContains('EXAMINE "INBOX"', $verbs);
        foreach ($verbs as $verb) {
            $this->assertDoesNotMatchRegularExpression('/^(SELECT|STORE|UID STORE|EXPUNGE|COPY|MOVE|UID COPY|UID MOVE|APPEND|DELETE)\b/i', $verb);
            if (str_starts_with($verb, 'UID FETCH')) {
                $this->assertStringNotContainsString('BODY[', $verb);
            }
        }
        $this->assertTrue($this->server->tls);
    }

    public function test_new_uidvalidity_does_not_replay_old_mail(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);

        $this->server->uidValidity = 2;
        $this->server->messages = [1 => $this->replyMessage(), 2 => $this->plainMessage()];
        $this->poller()->poll($mailbox->refresh());

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->uidvalidity);
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
    }

    public function test_oversized_message_is_skipped_before_its_body_is_read(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);

        $this->server->messages[2] = ['size' => ImipMailboxPoller::MAX_MESSAGE_BYTES + 1] + $this->replyMessage();
        $this->poller()->poll($mailbox->refresh());

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
        foreach ($this->server->verbs() as $verb) {
            $this->assertStringNotContainsString('BODY.PEEK[1.2]', $verb);
        }
    }

    public function test_calendar_part_above_the_calendar_size_cap_is_skipped(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);

        $big = $this->replyMessage();
        $big['sections']['1.2'] = base64_encode(str_repeat('X', 600_000));
        $this->server->messages[2] = $big;
        $this->poller()->poll($mailbox->refresh());

        $this->assertSame('NEEDS-ACTION', $this->guestStatus());
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
    }

    public function test_message_without_a_calendar_part_is_not_downloaded(): void
    {
        $this->server->messages = [1 => $this->plainMessage()];
        $mailbox = $this->connect();
        $this->poller()->poll($mailbox);
        $this->server->messages[2] = $this->plainMessage();
        $this->poller()->poll($mailbox->refresh());

        foreach ($this->server->verbs() as $verb) {
            $this->assertDoesNotMatchRegularExpression('/BODY\.PEEK\[[\d.]+\]/', $verb);
        }
        $this->assertSame(2, $mailbox->fresh()?->last_uid);
    }

    public function test_wrong_password_is_recorded_and_pauses_after_repeated_failures(): void
    {
        $mailbox = $this->connect();
        $this->server->password = 'changed';

        for ($i = 0; $i < ImipMailboxPoller::AUTH_FAILURE_PAUSE; $i++) {
            $this->poller()->poll($mailbox->refresh());
        }

        $fresh = $mailbox->fresh();
        $this->assertNotNull($fresh);
        $this->assertSame(ImapException::AUTH_FAILED, $fresh->last_error_code);
        $this->assertFalse($fresh->enabled);
        $this->assertSame(0, $this->poller()->pollDue(time() + 3600));
    }

    public function test_missing_folder_is_recorded(): void
    {
        $mailbox = $this->connect();
        $this->server->folder = 'Archive';

        $this->poller()->poll($mailbox);

        $this->assertSame(ImapException::FOLDER_MISSING, $mailbox->fresh()?->last_error_code);
    }

    public function test_cursor_waits_while_the_receiving_server_is_unknown(): void
    {
        $this->server->messages = [1 => $this->plainMessage(authResults: false)];
        $mailbox = $this->connect(trusted: '');
        $this->poller()->poll($mailbox);
        $this->server->messages[2] = $this->replyMessage();
        $this->poller()->poll($mailbox->refresh());

        $fresh = $mailbox->fresh();
        $this->assertNotNull($fresh);
        $this->assertSame(self::TRUSTED, $fresh->trusted_server_id);
        $this->assertSame('ACCEPTED', $this->guestStatus());
    }

    public function test_unknown_receiving_server_is_reported(): void
    {
        $this->server->messages = [1 => $this->plainMessage(authResults: false)];
        $mailbox = $this->connect(trusted: '');

        $this->poller()->poll($mailbox);

        $this->assertSame(ImipMailboxPoller::UNTRUSTED_SERVER_UNKNOWN, $mailbox->fresh()?->last_error_code);
    }

    public function test_a_mailbox_is_polled_at_most_once_per_interval(): void
    {
        $this->connect();
        $now = time();

        $this->assertSame(1, $this->poller()->pollDue($now));
        $this->assertSame(0, $this->poller()->pollDue($now + 30));
        $this->assertSame(1, $this->poller()->pollDue($now + ImipMailboxPoller::MIN_INTERVAL_SECONDS));
    }

    public function test_password_is_stored_encrypted(): void
    {
        $mailbox = $this->connect();

        $this->assertStringNotContainsString('mailbox-pass', (string) $mailbox->password_enc);
        $this->assertSame('mailbox-pass', $this->app->make(ImipMailboxSettings::class)->password($mailbox));
        $this->assertArrayNotHasKey('password_enc', $mailbox->toArray());
    }

    public function test_command_runs_from_the_scheduler(): void
    {
        $this->assertSame(0, Artisan::call('wgw:calendar:imip-poll'));
    }

    private function connect(string $trusted = self::TRUSTED): CalendarReplyMailbox
    {
        return $this->app->make(ImipMailboxSettings::class)->save('bob', [
            'host' => 'imap.example.test',
            'port' => 993,
            'security' => 'ssl',
            'login' => 'bob@example.test',
            'folder' => 'INBOX',
        ], 'mailbox-pass', $trusted);
    }

    private function poller(): ImipMailboxPoller
    {
        return $this->app->make(ImipMailboxPoller::class);
    }

    /**
     * Gmail-shaped: multipart/mixed with multipart/alternative (text, calendar)
     * and an application/ics attachment.
     *
     * @return array{size: int, headers: string, structure: string, sections: array<string, string>}
     */
    private function replyMessage(): array
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nMETHOD:REPLY\r\n"
            ."BEGIN:VEVENT\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nDTSTAMP:20300101T120000Z\r\n"
            ."ORGANIZER;CN=Bob:mailto:bob@example.test\r\nUID:".self::UID."\r\n"
            ."ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Guest\r\n Person;X-NUM-GUESTS=0:mailto:guest@elsewhere.test\r\n"
            ."SEQUENCE:0\r\nSTATUS:CONFIRMED\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $encoded = chunk_split(base64_encode($ics), 76, "\r\n");

        return [
            'size' => 4000,
            'headers' => $this->headerBlock(true),
            'structure' => '((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 40 2 NIL NIL NIL NIL)'
                .'("TEXT" "CALENDAR" ("CHARSET" "UTF-8" "METHOD" "REPLY") NIL NIL "BASE64" '.strlen($encoded).' 8 NIL NIL NIL NIL)'
                .' "ALTERNATIVE" ("BOUNDARY" "b2") NIL NIL NIL)'
                .'("APPLICATION" "ICS" ("NAME" "invite.ics") NIL NIL "BASE64" '.strlen($encoded).' NIL ("ATTACHMENT" ("FILENAME" "invite.ics")) NIL NIL)'
                .' "MIXED" ("BOUNDARY" "b1") NIL NIL NIL)',
            'sections' => ['1.2' => $encoded],
        ];
    }

    /**
     * @return array{size: int, headers: string, structure: string}
     */
    private function plainMessage(bool $authResults = true): array
    {
        return [
            'size' => 900,
            'headers' => $this->headerBlock($authResults),
            'structure' => '("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 120 4 NIL NIL NIL NIL)',
        ];
    }

    private function headerBlock(bool $authResults): string
    {
        $block = $authResults
            ? 'Authentication-Results: '.self::TRUSTED.";\r\n       dkim=pass header.i=@elsewhere.test;\r\n       spf=pass smtp.mailfrom=guest@elsewhere.test;\r\n       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=elsewhere.test\r\n"
            : '';

        return $block."From: Guest Person <guest@elsewhere.test>\r\nMessage-ID: <reply-1@elsewhere.test>\r\n\r\n";
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
