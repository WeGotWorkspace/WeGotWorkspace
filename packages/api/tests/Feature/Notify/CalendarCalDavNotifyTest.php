<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Notification;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\CollectionMetadataStateAssertions;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Bug #2057: scheduling done by a CalDAV client (Apple Calendar, Thunderbird)
 * notifies in the suite like the same action in the web app. Sabre's own
 * local delivery lands the message; the suite notification used to be left out.
 */
final class CalendarCalDavNotifyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use CollectionMetadataStateAssertions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setUpDavServer();
    }

    public function test_caldav_invite_notifies_the_attendee_and_not_the_organizer(): void
    {
        $uid = 'caldav-notify-'.uniqid();

        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));

        $rows = $this->rows('carol', 'invite');
        $this->assertCount(1, $rows);
        $this->assertSame('Bob invited you to Garden plan', $rows[0]->title);
        $this->assertStringStartsWith('calendar.invite:', (string) $rows[0]->tag);
        $this->assertCount(0, $this->rows('bob', 'invite'));
    }

    public function test_caldav_reschedule_updates_the_same_invite_row(): void
    {
        $uid = 'caldav-notify-move-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));
        $before = $this->rows('carol', 'invite')[0];
        $before->forceFill(['read_at' => now()])->save();

        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION', sequence: 1, start: '20300305T140000Z'));

        $rows = $this->rows('carol', 'invite');
        $this->assertCount(1, $rows);
        $this->assertSame($before->id, $rows[0]->id);
        $this->assertNotSame($before->data['start'] ?? null, $rows[0]->data['start'] ?? null);
        $this->assertNull($rows[0]->read_at);
    }

    public function test_caldav_description_only_update_does_not_ring_again(): void
    {
        $uid = 'caldav-notify-minor-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));
        $before = $this->rows('carol', 'invite')[0];
        $before->forceFill(['read_at' => now()])->save();

        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION', description: 'Bring gloves'));

        $rows = $this->rows('carol', 'invite');
        $this->assertCount(1, $rows);
        $this->assertNotNull($rows[0]->read_at);
    }

    public function test_caldav_rsvp_notifies_the_organizer(): void
    {
        $uid = 'caldav-notify-rsvp-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));

        $this->putEvent('carol', $uid, $this->ics($uid, 'ACCEPTED'), $this->objectUri('carol', $uid));

        $rows = $this->rows('bob', 'rsvp');
        $this->assertCount(1, $rows);
        $this->assertStringStartsWith('calendar.rsvp:', (string) $rows[0]->tag);
        $this->assertCount(0, $this->rows('carol', 'rsvp'));
    }

    public function test_caldav_cancel_clears_the_invite_row(): void
    {
        $uid = 'caldav-notify-cancel-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));
        $this->assertCount(1, $this->rows('carol', 'invite'));

        $deleted = $this->davRequest('bob', 'DELETE', "/calendars/bob/default/{$uid}.ics");

        $this->assertSame(204, $deleted['status']);
        $this->assertCount(0, $this->rows('carol', 'invite'));
    }

    public function test_caldav_cancel_clears_the_invite_row_when_the_attendee_has_no_copy(): void
    {
        $uid = 'caldav-notify-cancel-gone-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));
        $this->assertCount(1, $this->rows('carol', 'invite'));
        $carolUri = $this->objectUri('carol', $uid);

        $this->assertSame(204, $this->davRequest('carol', 'DELETE', "/calendars/carol/default/{$carolUri}")['status']);
        $this->assertSame(204, $this->davRequest('bob', 'DELETE', "/calendars/bob/default/{$uid}.ics")['status']);

        $this->assertCount(0, $this->rows('carol', 'invite'));
    }

    public function test_caldav_rsvp_notifies_the_organizer_when_the_organizer_copy_is_gone(): void
    {
        $uid = 'caldav-notify-rsvp-gone-'.uniqid();
        $this->putEvent('bob', $uid, $this->ics($uid, 'NEEDS-ACTION'));
        $carolUri = $this->objectUri('carol', $uid);
        $bobCalendarId = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', 'default')
            ->value('calendarid');
        CalendarObject::query()
            ->where('calendarid', (int) $bobCalendarId)
            ->where('uid', $uid)
            ->delete();

        $this->putEvent('carol', $uid, $this->ics($uid, 'ACCEPTED'), $carolUri);

        $this->assertCount(1, $this->rows('bob', 'rsvp'));
    }

    private function putEvent(string $username, string $uid, string $ics, ?string $objectUri = null): void
    {
        $path = "/calendars/{$username}/default/".($objectUri ?? "{$uid}.ics");
        $response = $this->davRequest($username, 'PUT', $path, $ics, ['Content-Type' => 'text/calendar']);

        $this->assertContains($response['status'], [201, 204], $response['body']);
    }

    /** The object Sabre's local delivery created in $username's default calendar. */
    private function objectUri(string $username, string $uid): string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', 'default')
            ->value('calendarid');
        $uri = CalendarObject::query()
            ->where('calendarid', (int) $calendarId)
            ->where('uid', $uid)
            ->value('uri');
        $this->assertIsString($uri);

        return $uri;
    }

    /**
     * @return list<Notification>
     */
    private function rows(string $principal, string $action): array
    {
        return array_values(Notification::query()
            ->where('principal', $principal)
            ->where('domain', 'calendar')
            ->where('action', $action)
            ->get()
            ->all());
    }

    private function ics(
        string $uid,
        string $carolStatus,
        int $sequence = 0,
        string $start = '20300304T100000Z',
        string $description = '',
    ): string {
        return implode("\r\n", array_filter([
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WGW//Test//EN',
            'BEGIN:VEVENT', "UID:{$uid}", 'DTSTAMP:20300101T000000Z', "SEQUENCE:{$sequence}",
            'SUMMARY:Garden plan', "DTSTART:{$start}", 'DURATION:PT1H',
            $description !== '' ? "DESCRIPTION:{$description}" : '',
            'ORGANIZER;CN=Bob:mailto:bob@example.test',
            "ATTENDEE;CN=Carol;PARTSTAT={$carolStatus};RSVP=TRUE:mailto:carol@example.test",
            'END:VEVENT', 'END:VCALENDAR',
        ]))."\r\n";
    }
}
