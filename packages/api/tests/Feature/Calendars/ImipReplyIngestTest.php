<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Models\Notification;
use App\Services\Calendars\Imip\ImipReplyIngest;
use App\Services\Calendars\Imip\ImipReplyOutcome;
use App\Services\Calendars\Imip\ImipReplyRateLimiter;
use App\Services\Calendars\Imip\MailHeaders;
use Illuminate\Support\Facades\Cache;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Inbound iMIP REPLY ingest (#1589): which replies change the organizer's
 * event, and that only the sender's own attendee line changes.
 */
final class ImipReplyIngestTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TRUSTED = 'mx.receiver.test';

    private const UID = 'imip-reply-event-1';

    private const SERIES_UID = 'imip-reply-series-1';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
        $this->seedEventViaPdo('bob', 'planning.ics', $this->organizerIcs(self::UID, sequence: 2));
    }

    public function test_verified_reply_updates_attendee_status_and_notifies_organizer(): void
    {
        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(sequence: 2));

        $this->assertSame(ImipReplyOutcome::APPLIED, $outcome->status);
        $this->assertSame('ACCEPTED', $this->attendeeStatus(self::UID, 'guest@elsewhere.test'));
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::UID, 'other@elsewhere.test'));
        $row = Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->first();
        $this->assertNotNull($row);
        $this->assertSame('Guest Person accepted Planning', $row->title);
    }

    public function test_reply_without_trusted_authentication_is_skipped(): void
    {
        $headers = MailHeaders::parse("From: guest@elsewhere.test\r\n");

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_results_from_another_server_do_not_count(): void
    {
        $headers = $this->headers('guest@elsewhere.test', results: [
            'mx.other.test; dmarc=pass header.from=elsewhere.test',
        ]);

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_only_the_topmost_result_of_the_receiving_server_counts(): void
    {
        $headers = $this->headers('guest@elsewhere.test', results: [
            self::TRUSTED.'; dmarc=fail header.from=elsewhere.test; spf=fail smtp.mailfrom=elsewhere.test',
            self::TRUSTED.'; dmarc=pass header.from=elsewhere.test',
        ]);

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_failing_dmarc_is_skipped_even_with_a_dkim_pass(): void
    {
        $headers = $this->headers('guest@elsewhere.test', results: [
            self::TRUSTED.'; dkim=pass header.d=elsewhere.test; dmarc=fail header.from=elsewhere.test',
        ]);

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_aligned_dkim_pass_is_accepted(): void
    {
        $headers = $this->headers('guest@elsewhere.test', results: [
            self::TRUSTED.' 1; dkim=pass (2048-bit key) header.d=mail.elsewhere.test header.s=s1; spf=softfail',
        ]);

        $this->assertSame(ImipReplyOutcome::APPLIED, $this->ingest($headers, $this->reply())->status);
    }

    public function test_unaligned_dkim_and_spf_passes_are_skipped(): void
    {
        $headers = $this->headers('guest@elsewhere.test', results: [
            self::TRUSTED.'; dkim=pass header.d=bulk-sender.test; spf=pass smtp.mailfrom=bounce@bulk-sender.test',
        ]);

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_message_with_two_senders_is_skipped(): void
    {
        $headers = $this->headers('guest@elsewhere.test, other@elsewhere.test');

        $this->assertSkipped(ImipReplyIngest::SENDER_NOT_VERIFIED, $this->ingest($headers, $this->reply()));
    }

    public function test_reply_naming_another_attendee_is_skipped(): void
    {
        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(attendee: 'other@elsewhere.test'));

        $this->assertSkipped(ImipReplyIngest::ATTENDEE_MISMATCH, $outcome);
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::UID, 'other@elsewhere.test'));
    }

    public function test_reply_with_two_attendee_lines_is_skipped(): void
    {
        $reply = str_replace(
            "ATTENDEE;CN=Guest Person;PARTSTAT=ACCEPTED:mailto:guest@elsewhere.test\r\n",
            "ATTENDEE;CN=Guest Person;PARTSTAT=ACCEPTED:mailto:guest@elsewhere.test\r\nATTENDEE;PARTSTAT=DECLINED:mailto:other@elsewhere.test\r\n",
            $this->reply(),
        );

        $this->assertSkipped(ImipReplyIngest::ATTENDEE_MISMATCH, $this->ingest($this->headers('guest@elsewhere.test'), $reply));
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::UID, 'other@elsewhere.test'));
    }

    public function test_reply_from_someone_not_invited_is_skipped(): void
    {
        $outcome = $this->ingest($this->headers('stranger@elsewhere.test'), $this->reply(attendee: 'stranger@elsewhere.test'));

        $this->assertSkipped(ImipReplyIngest::NOT_AN_ATTENDEE, $outcome);
        $this->assertNull($this->attendeeStatus(self::UID, 'stranger@elsewhere.test'));
    }

    public function test_reply_naming_another_organizer_is_skipped(): void
    {
        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(organizer: 'carol@example.test'));

        $this->assertSkipped(ImipReplyIngest::ORGANIZER_MISMATCH, $outcome);
    }

    public function test_reply_for_an_event_the_owner_does_not_organize_is_skipped(): void
    {
        $this->seedEventViaPdo('carol', 'carol-event.ics', $this->organizerIcs('carol-uid-1', organizer: 'carol@example.test'));

        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(uid: 'carol-uid-1'));

        $this->assertSkipped(ImipReplyIngest::EVENT_NOT_FOUND, $outcome);
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus('carol-uid-1', 'guest@elsewhere.test'));
    }

    public function test_reply_with_an_older_sequence_is_skipped(): void
    {
        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(sequence: 1));

        $this->assertSkipped(ImipReplyIngest::STALE_SEQUENCE, $outcome);
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::UID, 'guest@elsewhere.test'));
    }

    public function test_unsupported_status_is_skipped(): void
    {
        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(status: 'DELEGATED'));

        $this->assertSkipped(ImipReplyIngest::UNSUPPORTED_STATUS, $outcome);
    }

    public function test_request_and_cancel_messages_change_nothing(): void
    {
        $before = $this->rawEvent(self::UID);
        foreach (['REQUEST', 'CANCEL'] as $method) {
            $ics = str_replace('METHOD:REPLY', 'METHOD:'.$method, $this->reply());
            $this->assertSkipped(ImipReplyIngest::METHOD_NOT_SUPPORTED, $this->ingest($this->headers('guest@elsewhere.test'), $ics));
        }

        $this->assertSame($before, $this->rawEvent(self::UID));
        $this->assertSame(1, CalendarObject::query()->where('uid', self::UID)->count());
    }

    public function test_repeat_of_the_same_reply_changes_nothing_and_notifies_once(): void
    {
        $this->assertSame(ImipReplyOutcome::APPLIED, $this->ingest($this->headers('guest@elsewhere.test'), $this->reply())->status);
        $after = $this->rawEvent(self::UID);

        $this->assertSame(ImipReplyOutcome::UNCHANGED, $this->ingest($this->headers('guest@elsewhere.test'), $this->reply())->status);

        $this->assertSame($after, $this->rawEvent(self::UID));
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->count());
    }

    public function test_reply_for_one_occurrence_changes_only_that_occurrence(): void
    {
        $this->seedEventViaPdo('bob', 'series.ics', $this->organizerIcs(self::SERIES_UID, rrule: 'FREQ=WEEKLY;COUNT=5'));
        $reply = $this->reply(uid: self::SERIES_UID, sequence: 0, recurrenceId: '20300208T100000Z', status: 'DECLINED');

        $this->assertSame(ImipReplyOutcome::APPLIED, $this->ingest($this->headers('guest@elsewhere.test'), $reply)->status);

        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::SERIES_UID, 'guest@elsewhere.test'));
        $this->assertSame('DECLINED', $this->attendeeStatus(self::SERIES_UID, 'guest@elsewhere.test', '20300208T100000Z'));
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::SERIES_UID, 'other@elsewhere.test', '20300208T100000Z'));
    }

    public function test_reply_for_an_occurrence_outside_the_series_is_skipped(): void
    {
        $this->seedEventViaPdo('bob', 'series.ics', $this->organizerIcs(self::SERIES_UID, rrule: 'FREQ=WEEKLY;COUNT=5'));
        $reply = $this->reply(uid: self::SERIES_UID, sequence: 0, recurrenceId: '20310208T100000Z');

        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $reply);

        $this->assertNotSame(ImipReplyOutcome::APPLIED, $outcome->status);
        $this->assertSame('NEEDS-ACTION', $this->attendeeStatus(self::SERIES_UID, 'guest@elsewhere.test'));
    }

    public function test_replies_per_sender_are_rate_limited(): void
    {
        for ($i = 0; $i < ImipReplyRateLimiter::SENDER_LIMIT; $i++) {
            $status = $i % 2 === 0 ? 'ACCEPTED' : 'DECLINED';
            $this->assertSame(
                ImipReplyOutcome::APPLIED,
                $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(status: $status))->status,
            );
        }

        $outcome = $this->ingest($this->headers('guest@elsewhere.test'), $this->reply(status: 'TENTATIVE'));

        $this->assertSkipped(ImipReplyIngest::RATE_LIMITED, $outcome);
        $this->assertSame('DECLINED', $this->attendeeStatus(self::UID, 'guest@elsewhere.test'));
    }

    public function test_calendar_part_with_a_task_is_skipped(): void
    {
        $ics = str_replace(['BEGIN:VEVENT', 'END:VEVENT'], ['BEGIN:VTODO', 'END:VTODO'], $this->reply());

        $this->assertSkipped(ImipReplyIngest::INVALID_CALENDAR, $this->ingest($this->headers('guest@elsewhere.test'), $ics));
    }

    private function ingest(MailHeaders $headers, string $ics): ImipReplyOutcome
    {
        return $this->app->make(ImipReplyIngest::class)->ingest('bob', self::TRUSTED, $headers, $ics, 7);
    }

    private function assertSkipped(string $reason, ImipReplyOutcome $outcome): void
    {
        $this->assertSame(ImipReplyOutcome::SKIPPED, $outcome->status);
        $this->assertSame($reason, $outcome->reason);
    }

    /**
     * @param  list<string>|null  $results  Authentication-Results values, top first
     */
    private function headers(string $from, ?array $results = null): MailHeaders
    {
        $results ??= [self::TRUSTED.'; spf=pass smtp.mailfrom=elsewhere.test; dkim=pass header.d=elsewhere.test; dmarc=pass (p=NONE) header.from=elsewhere.test'];
        $lines = [];
        foreach ($results as $value) {
            $lines[] = 'Authentication-Results: '.$value;
        }
        $lines[] = 'From: "Guest Person" <'.$from.'>';

        return MailHeaders::parse(implode("\r\n", $lines)."\r\n");
    }

    private function reply(
        string $uid = self::UID,
        int $sequence = 2,
        string $attendee = 'guest@elsewhere.test',
        string $organizer = 'bob@example.test',
        string $status = 'ACCEPTED',
        ?string $recurrenceId = null,
    ): string {
        $recurrence = $recurrenceId !== null ? 'RECURRENCE-ID:'.$recurrenceId."\r\n" : '';

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Reply//EN\r\nMETHOD:REPLY\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\n{$recurrence}DTSTAMP:20300101T120000Z\r\nSEQUENCE:{$sequence}\r\n"
            ."DTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nSUMMARY:Planning\r\n"
            ."ORGANIZER:mailto:{$organizer}\r\n"
            ."ATTENDEE;CN=Guest Person;PARTSTAT={$status}:mailto:{$attendee}\r\n"
            ."REQUEST-STATUS:2.0;Success\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function organizerIcs(string $uid, int $sequence = 0, string $organizer = 'bob@example.test', ?string $rrule = null): string
    {
        $repeat = $rrule !== null ? 'RRULE:'.$rrule."\r\n" : '';

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\n"
            ."DTSTAMP:20300101T000000Z\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\n{$repeat}"
            ."SUMMARY:Planning\r\nSEQUENCE:{$sequence}\r\nORGANIZER;CN=Organizer:mailto:{$organizer}\r\n"
            ."ATTENDEE;CN=Organizer;PARTSTAT=ACCEPTED:mailto:{$organizer}\r\n"
            ."ATTENDEE;CN=Guest;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@elsewhere.test\r\n"
            ."ATTENDEE;CN=Other;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:other@elsewhere.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function rawEvent(string $uid): string
    {
        return (string) CalendarObject::query()->where('uid', $uid)->value('calendardata');
    }

    private function attendeeStatus(string $uid, string $email, ?string $recurrenceId = null): ?string
    {
        $calendar = Reader::read($this->rawEvent($uid));
        $this->assertInstanceOf(VCalendar::class, $calendar);
        foreach ($calendar->select('VEVENT') as $vevent) {
            $id = isset($vevent->{'RECURRENCE-ID'}) ? (string) $vevent->{'RECURRENCE-ID'} : null;
            if ($id !== $recurrenceId) {
                continue;
            }
            foreach ($vevent->select('ATTENDEE') as $attendee) {
                if (strtolower((string) $attendee) === 'mailto:'.$email) {
                    return strtoupper((string) $attendee['PARTSTAT']);
                }
            }
        }

        return null;
    }
}
