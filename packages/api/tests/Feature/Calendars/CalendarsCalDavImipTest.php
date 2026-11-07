<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarRsvpToken;
use App\Services\Calendars\CalendarImipService;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Bug #1929: an invite, update or cancel a native CalDAV client writes for an
 * address outside the instance goes out by iMIP, with the same rules as the
 * web app (external invites setting, caps, mail transport).
 */
final class CalendarsCalDavImipTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const GUEST = 'guest@elsewhere.test';

    /** What an external attendee's schedule-status was before #1929, and still is when no mail goes out. */
    private const NOT_SENT_STATUS = '3.7';

    private ?string $sabreDataDir = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
        Cache::flush();
        $this->enableMailSubmit();
    }

    protected function tearDown(): void
    {
        if ($this->sabreDataDir !== null) {
            File::deleteDirectory($this->sabreDataDir);
            $this->sabreDataDir = null;
        }
        parent::tearDown();
    }

    public function test_caldav_invite_to_an_external_address_sends_one_imip_request(): void
    {
        $uid = 'caldav-imip-'.uniqid();

        $this->assertContains($this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST])), [201, 204]);

        $requests = $this->sentMails('REQUEST');
        $this->assertCount(1, $requests);
        $this->assertSame([self::GUEST], $requests[0]->outbound->to);
        $this->assertSame('Invitation: Garden plan', $requests[0]->outbound->subject);
        $this->assertStringContainsString('METHOD:REQUEST', (string) $requests[0]->outbound->calendarIcs);
        $this->assertStringContainsString('/calendar/rsvp/', $requests[0]->outbound->textBody);

        $token = CalendarRsvpToken::query()->sole();
        $this->assertSame(self::GUEST, (string) $token->attendee_email);
        $this->assertSame('bob', (string) $token->organizer_username);
        $this->assertSame('1.1', $this->scheduleStatus($uid, self::GUEST));
    }

    public function test_local_attendees_get_local_delivery_and_no_mail(): void
    {
        $uid = 'caldav-imip-local-'.uniqid();

        $this->assertContains($this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Team sync', ['carol@example.test', self::GUEST])), [201, 204]);

        $requests = $this->sentMails('REQUEST');
        $this->assertCount(1, $requests);
        $this->assertSame([self::GUEST], $requests[0]->outbound->to);
        $this->assertSame(1, DB::connection('wgw')->table('schedulingobjects')->where('principaluri', 'principals/carol')->count());
        $this->assertStringStartsWith('1.2', (string) $this->scheduleStatus($uid, 'carol@example.test'));
    }

    public function test_external_invites_off_sends_nothing_and_keeps_todays_status(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        $uid = 'caldav-imip-off-'.uniqid();

        $this->assertContains($this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST])), [201, 204]);

        Mail::assertNothingSent();
        $this->assertSame(0, CalendarRsvpToken::query()->count());
        $this->assertStringStartsWith(self::NOT_SENT_STATUS, (string) $this->scheduleStatus($uid, self::GUEST));
    }

    public function test_without_a_mail_transport_nothing_is_sent_and_the_status_is_unchanged(): void
    {
        $this->app->instance(MailDeliveryTransportResolver::class, new MailDeliveryTransportResolver(
            phpMailProbe: static fn (): bool => false,
            sendmailProbe: static fn (): bool => false,
        ));
        $this->app->forgetInstance(CalendarImipService::class);
        $uid = 'caldav-imip-nomail-'.uniqid();

        $this->assertContains($this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST])), [201, 204]);

        Mail::assertNothingSent();
        $this->assertSame(0, CalendarRsvpToken::query()->count());
        $this->assertStringStartsWith(self::NOT_SENT_STATUS, (string) $this->scheduleStatus($uid, self::GUEST));
    }

    public function test_the_organizers_hourly_cap_applies_to_caldav_invites(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_HOURLY_LIMIT, 1);
        $first = 'caldav-imip-cap-a-'.uniqid();
        $second = 'caldav-imip-cap-b-'.uniqid();

        $this->sabre('PUT', 'bob', $first, $this->ics($first, 'First', [self::GUEST]));
        $this->sabre('PUT', 'bob', $second, $this->ics($second, 'Second', ['other@elsewhere.test']));

        $this->assertCount(1, $this->sentMails('REQUEST'));
        $this->assertStringStartsWith(self::NOT_SENT_STATUS, (string) $this->scheduleStatus($second, 'other@elsewhere.test'));
    }

    public function test_significant_update_and_delete_send_a_new_request_and_a_cancel(): void
    {
        $uid = 'caldav-imip-update-'.uniqid();
        $this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST]));

        $this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST], sequence: 1, start: '20300305T100000Z'));
        $this->assertCount(2, $this->sentMails('REQUEST'));

        $this->assertSame(204, $this->sabre('DELETE', 'bob', $uid));
        $cancels = $this->sentMails('CANCEL');
        $this->assertCount(1, $cancels);
        $this->assertSame([self::GUEST], $cancels[0]->outbound->to);
    }

    public function test_description_only_update_sends_no_new_mail(): void
    {
        $uid = 'caldav-imip-minor-'.uniqid();
        $this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST]));

        $this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST], description: 'Bring gloves'));

        $this->assertCount(1, $this->sentMails('REQUEST'));
    }

    public function test_cancel_still_reaches_an_invited_guest_when_invites_are_turned_off(): void
    {
        $uid = 'caldav-imip-cancel-off-'.uniqid();
        $this->sabre('PUT', 'bob', $uid, $this->ics($uid, 'Garden plan', [self::GUEST]));
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);

        $this->sabre('DELETE', 'bob', $uid);

        $this->assertCount(1, $this->sentMails('CANCEL'));
    }

    /**
     * @param  list<string>  $attendees
     */
    private function ics(
        string $uid,
        string $summary,
        array $attendees,
        int $sequence = 0,
        string $start = '20300304T100000Z',
        ?string $description = null,
    ): string {
        $lines = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WGW//Test//EN',
            'BEGIN:VEVENT', "UID:{$uid}", 'DTSTAMP:20300101T000000Z', "SEQUENCE:{$sequence}",
            "SUMMARY:{$summary}", "DTSTART:{$start}", 'DURATION:PT1H',
            'ORGANIZER;CN=Bob:mailto:bob@example.test',
        ];
        if ($description !== null) {
            $lines[] = "DESCRIPTION:{$description}";
        }
        foreach ($attendees as $attendee) {
            $lines[] = "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{$attendee}";
        }
        array_push($lines, 'END:VEVENT', 'END:VCALENDAR');

        return implode("\r\n", $lines)."\r\n";
    }

    /**
     * One CalDAV request as $username on their default calendar. Sabre keeps
     * its lock file in the data dir, so the test points it at a temporary dir.
     */
    private function sabre(string $method, string $username, string $uid, string $body = ''): int
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-imip-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;

        $server = app(SabreServerFactory::class)->create();
        $headers = ['Authorization' => $auth, 'Content-Type' => 'text/calendar'];
        $request = new SabreRequest($method, "/calendars/{$username}/default/{$uid}.ics", $headers, $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return $e->getHTTPCode();
        }

        return $response->getStatus();
    }

    /**
     * @return list<OutboundMessageMail>
     */
    private function sentMails(string $method): array
    {
        return array_values(Mail::sent(
            OutboundMessageMail::class,
            static fn (OutboundMessageMail $mail): bool => $mail->outbound->calendarMethod === $method,
        )->all());
    }

    /** SCHEDULE-STATUS Sabre stored on the organizer's copy for $email. */
    private function scheduleStatus(string $uid, string $email): ?string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', 'default')
            ->value('calendarid');
        $data = CalendarObject::query()
            ->where('calendarid', (int) $calendarId)
            ->where('uid', $uid)
            ->value('calendardata');
        $this->assertIsString($data);
        $calendar = Reader::read($data);
        $this->assertInstanceOf(VCalendar::class, $calendar);
        $event = $calendar->VEVENT;
        $this->assertNotNull($event);
        foreach ($event->select('ATTENDEE') as $attendee) {
            if (strcasecmp((string) $attendee->getValue(), 'mailto:'.$email) === 0) {
                $status = $attendee['SCHEDULE-STATUS'] ?? null;

                return $status === null ? null : (string) $status;
            }
        }

        return null;
    }

    private function enableMailSubmit(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'calendar@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
        $this->app->instance(MailDeliveryTransportResolver::class, new MailDeliveryTransportResolver(
            phpMailProbe: static fn (): bool => true,
            sendmailProbe: static fn (): bool => true,
        ));
    }
}
