<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\Principal;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Jmap\JmapCapabilities;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Sabre\VObject\Reader;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Someone outside your Teams is scheduled like an external guest (Task #1923):
 * JMAP and CalDAV send iMIP instead of a local copy, with the same
 * schedule-status as an external address, and VFREEBUSY answers like an
 * unknown address. Admins invite everyone locally, but free/busy follows real
 * Team membership for them too.
 *
 * bob and dave share Team t1. carol is in no Team with bob. alice is the admin
 * and in no Team with carol. dave and carol share their availability (#1907),
 * so free/busy turns on the Team rule alone.
 */
final class CalendarSchedulingOutsideTeamsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const UNKNOWN = 'nobody@unknown.test';

    private ?string $sabreDataDir = null;

    private string $availabilityCacheDir = '';

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedDefaultCalendarFor('dave');
        $this->seedDefaultCalendarFor('alice');
        $this->putInTeam('t1', ['bob', 'dave']);
        Mail::fake();
        Cache::flush();
        $this->enableMailSubmit();
        $this->availabilityCacheDir = sys_get_temp_dir().'/wgw-scheduling-availability-'.uniqid('', true);
        config(['cache.stores.availability.path' => $this->availabilityCacheDir]);
        Cache::purge('availability');
        foreach (['dave', 'carol'] as $username) {
            app(AvailabilitySettings::class)->setEnabled($username, true);
        }
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->availabilityCacheDir);
        if ($this->sabreDataDir !== null) {
            File::deleteDirectory($this->sabreDataDir);
            $this->sabreDataDir = null;
        }
        parent::tearDown();
    }

    // ---- JMAP ---------------------------------------------------------------

    public function test_jmap_invite_reaches_a_colleague_locally_and_a_non_colleague_by_email(): void
    {
        $this->inviteViaJmap('bob', ['dave@example.test', 'carol@example.test']);

        $this->assertCount(1, $this->inboxRows('dave'));
        $this->assertSame([], $this->inboxRows('carol'));
        $this->assertSame([], $this->ownedUids('carol'));
        $this->assertSame(['carol@example.test'], $this->imipRecipients('REQUEST'));
    }

    public function test_jmap_invite_to_a_non_colleague_is_skipped_when_external_invites_are_off(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);

        $this->inviteViaJmap('bob', ['dave@example.test', 'carol@example.test']);

        $this->assertCount(1, $this->inboxRows('dave'));
        $this->assertSame([], $this->inboxRows('carol'));
        $this->assertSame([], $this->imipRecipients('REQUEST'));
    }

    public function test_jmap_does_not_canonicalise_a_typed_address_of_a_non_colleague(): void
    {
        $eventId = $this->inviteViaJmap('bob', ['dave', 'carol']);

        $emails = $this->participantEmails('bob', $eventId);
        $this->assertContains('dave@example.test', $emails, 'a colleague is rewritten to the canonical address');
        $this->assertContains('carol', $emails, 'a non-colleague keeps the typed address');
        $this->assertNotContains('carol@example.test', $emails);
    }

    public function test_an_admin_invites_anyone_locally_and_the_reply_comes_back_locally(): void
    {
        $eventId = $this->inviteViaJmap('alice', ['carol@example.test']);

        $this->assertCount(1, $this->inboxRows('carol'));
        $this->assertSame([], $this->imipRecipients('REQUEST'));

        $notificationId = (string) $this->as('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.id');
        $this->as('carol')->postJson('/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond', [
            'participationStatus' => 'accepted',
        ])->assertOk();

        $this->assertSame([], $this->imipRecipients('REPLY'));
        $this->assertContains('accepted', $this->partstatsOf('alice', $eventId, 'carol@example.test'));
    }

    // ---- CalDAV -------------------------------------------------------------

    public function test_caldav_invite_to_a_non_colleague_goes_out_by_email_like_an_external_address(): void
    {
        $uid = 'caldav-outside-'.uniqid();
        $status = $this->sabre('bob', 'PUT', '/calendars/bob/default/outside.ics', $this->inviteIcs(
            $uid,
            'bob@example.test',
            ['dave@example.test', 'carol@example.test', 'guest@elsewhere.test'],
        ), ['Content-Type' => 'text/calendar'])['status'];

        $this->assertContains($status, [201, 204]);
        $this->assertSame([$uid], $this->ownedUids('dave'));
        $this->assertSame([], $this->ownedUids('carol'));
        $this->assertSame([], $this->inboxRows('carol'));

        $scheduleStatus = $this->attendeeScheduleStatuses('bob', $uid);
        $this->assertStringStartsWith('1.2', (string) $scheduleStatus['dave@example.test']);
        $this->assertStringStartsWith('1.1', (string) $scheduleStatus['carol@example.test']);
        $this->assertSame($scheduleStatus['guest@elsewhere.test'], $scheduleStatus['carol@example.test']);
        $recipients = $this->imipRecipients('REQUEST');
        sort($recipients);
        $this->assertSame(['carol@example.test', 'guest@elsewhere.test'], $recipients, 'one email each, none for the colleague');
    }

    public function test_caldav_invite_to_a_non_colleague_is_not_sent_when_external_invites_are_off(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        $uid = 'caldav-outside-off-'.uniqid();
        $this->sabre('bob', 'PUT', '/calendars/bob/default/outside-off.ics', $this->inviteIcs(
            $uid,
            'bob@example.test',
            ['carol@example.test', 'guest@elsewhere.test'],
        ), ['Content-Type' => 'text/calendar']);

        $this->assertSame([], $this->ownedUids('carol'));
        $this->assertSame([], $this->imipRecipients('REQUEST'));
        $scheduleStatus = $this->attendeeScheduleStatuses('bob', $uid);
        $this->assertStringStartsWith('3.7', (string) $scheduleStatus['carol@example.test']);
        $this->assertSame($scheduleStatus['guest@elsewhere.test'], $scheduleStatus['carol@example.test']);
    }

    public function test_caldav_invite_from_an_admin_reaches_anyone_locally(): void
    {
        $uid = 'caldav-admin-'.uniqid();
        $status = $this->sabre('alice', 'PUT', '/calendars/alice/default/admin.ics', $this->inviteIcs(
            $uid,
            'alice@example.test',
            ['carol@example.test'],
        ), ['Content-Type' => 'text/calendar'])['status'];

        $this->assertContains($status, [201, 204]);
        $this->assertSame([$uid], $this->ownedUids('carol'));
    }

    // ---- VFREEBUSY ----------------------------------------------------------

    public function test_free_busy_answers_for_a_colleague_only(): void
    {
        $this->seedEventViaPdo('dave', 'busy.ics', $this->sampleIcs('Busy', null, '20300304T100000Z', '20300304T110000Z'));
        $this->seedEventViaPdo('carol', 'busy.ics', $this->sampleIcs('Busy', null, '20300304T100000Z', '20300304T110000Z'));

        $responses = $this->freeBusy('bob', ['dave@example.test', 'carol@example.test', self::UNKNOWN]);

        $this->assertSame('2.0;Success', $responses['mailto:dave@example.test']['status']);
        $this->assertStringContainsString('FREEBUSY', (string) $responses['mailto:dave@example.test']['data']);
        $this->assertSame('3.7;Could not find principal', $responses['mailto:carol@example.test']['status']);
        $this->assertSame($this->withoutHref($responses['mailto:'.self::UNKNOWN]), $this->withoutHref($responses['mailto:carol@example.test']));
    }

    public function test_free_busy_follows_real_team_membership_for_admins_too(): void
    {
        $this->seedEventViaPdo('carol', 'busy.ics', $this->sampleIcs('Busy', null, '20300304T100000Z', '20300304T110000Z'));

        $responses = $this->freeBusy('alice', ['carol@example.test', self::UNKNOWN]);

        $this->assertSame('3.7;Could not find principal', $responses['mailto:carol@example.test']['status']);
        $this->assertSame($this->withoutHref($responses['mailto:'.self::UNKNOWN]), $this->withoutHref($responses['mailto:carol@example.test']));

        $this->putInTeam('t2', ['alice', 'carol']);

        $this->assertSame('2.0;Success', $this->freeBusy('alice', ['carol@example.test'])['mailto:carol@example.test']['status']);
    }

    // ---- helpers ------------------------------------------------------------

    /**
     * @param  list<string>  $usernames
     */
    private function putInTeam(string $slug, array $usernames): void
    {
        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $uri = 'principals/groups/'.$slug;
        $team = Principal::query()->where('uri', $uri)->first() ?? $this->seedWgwGroup($uri, strtoupper($slug));
        foreach ($usernames as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    /**
     * @param  list<string>  $attendees
     */
    private function inviteViaJmap(string $organizer, array $attendees): string
    {
        $participants = ['org' => [
            '@type' => 'Participant',
            'email' => $organizer.'@example.test',
            'roles' => ['owner'],
        ]];
        foreach ($attendees as $index => $email) {
            $participants['a'.$index] = [
                '@type' => 'Participant',
                'email' => $email,
                'roles' => ['attendee'],
                'expectReply' => true,
                'participationStatus' => 'needs-action',
            ];
        }
        $created = $this->jmapAs($organizer, [[
            'CalendarEvent/set',
            ['accountId' => $organizer, 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Planning',
                'start' => '2030-03-04T10:00:00Z',
                'end' => '2030-03-04T11:00:00Z',
                'participants' => $participants,
            ]]],
            'c0',
        ]])->assertOk();
        $id = $created->json('methodResponses.0.1.created.inv.id');
        $this->assertIsString($id, (string) $created->getContent());

        return $id;
    }

    /**
     * @return list<string>
     */
    private function participantEmails(string $username, string $eventId): array
    {
        $event = $this->jmapAs($username, [
            ['CalendarEvent/get', ['accountId' => $username, 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        return array_values(array_map(
            static fn (array $participant): string => (string) ($participant['email'] ?? ''),
            (array) ($event['participants'] ?? []),
        ));
    }

    /**
     * @return list<string>
     */
    private function partstatsOf(string $username, string $eventId, string $email): array
    {
        $event = $this->jmapAs($username, [
            ['CalendarEvent/get', ['accountId' => $username, 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ((array) ($event['participants'] ?? []) as $participant) {
            if (($participant['email'] ?? '') === $email) {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? ''));
            }
        }

        return $partstats;
    }

    /**
     * @param  list<array<int|string, mixed>>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->as($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function as(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    /**
     * @return list<string>
     */
    private function imipRecipients(string $method): array
    {
        $recipients = [];
        foreach (Mail::sent(OutboundMessageMail::class) as $mail) {
            if ($mail->outbound->calendarMethod !== $method) {
                continue;
            }
            foreach ($mail->outbound->to as $to) {
                $recipients[] = strtolower(is_array($to) ? (string) ($to['address'] ?? '') : (string) $to);
            }
        }
        sort($recipients);

        return $recipients;
    }

    /**
     * @return list<string>
     */
    private function inboxRows(string $username): array
    {
        return array_values(DB::connection('wgw')->table('schedulingobjects')
            ->where('principaluri', 'principals/'.$username)
            ->pluck('calendardata')
            ->map(static fn (mixed $data): string => (string) $data)
            ->all());
    }

    /**
     * UIDs of events in calendars the user owns.
     *
     * @return list<string>
     */
    private function ownedUids(string $username): array
    {
        return array_values(DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/'.$username)
            ->where('calendarinstances.access', 1)
            ->pluck('calendarobjects.uid')
            ->map(static fn (mixed $uid): string => (string) $uid)
            ->all());
    }

    /**
     * SCHEDULE-STATUS per attendee address on the organizer's stored object.
     *
     * @return array<string, string|null>
     */
    private function attendeeScheduleStatuses(string $organizer, string $uid): array
    {
        $data = DB::connection('wgw')->table('calendarobjects')
            ->join('calendarinstances', 'calendarinstances.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendarinstances.principaluri', 'principals/'.$organizer)
            ->where('calendarobjects.uid', $uid)
            ->value('calendarobjects.calendardata');
        $this->assertNotNull($data);
        $vcalendar = Reader::read((string) $data);

        $statuses = [];
        foreach ($vcalendar->VEVENT->ATTENDEE ?? [] as $attendee) {
            $address = strtolower(preg_replace('/^mailto:/i', '', (string) $attendee) ?? '');
            $statuses[$address] = isset($attendee['SCHEDULE-STATUS']) ? (string) $attendee['SCHEDULE-STATUS'] : null;
        }

        return $statuses;
    }

    /**
     * @param  list<string>  $attendees
     */
    private function inviteIcs(string $uid, string $organizer, array $attendees): string
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\nSEQUENCE:0\r\nSUMMARY:Planning\r\n"
            ."DTSTART:20300304T100000Z\r\nDTEND:20300304T110000Z\r\n"
            ."ORGANIZER:mailto:{$organizer}\r\n";
        foreach ($attendees as $attendee) {
            $ics .= "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{$attendee}\r\n";
        }

        return $ics."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * POST a VFREEBUSY request to the caller's outbox.
     *
     * @param  list<string>  $attendees
     * @return array<string, array{status: string, data: string|null, xml: string}>
     */
    private function freeBusy(string $username, array $attendees): array
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\nMETHOD:REQUEST\r\n"
            ."BEGIN:VFREEBUSY\r\nUID:fb-".uniqid()."\r\nDTSTAMP:20300101T000000Z\r\n"
            ."DTSTART:20300304T000000Z\r\nDTEND:20300305T000000Z\r\n"
            ."ORGANIZER:mailto:{$username}@example.test\r\n";
        foreach ($attendees as $attendee) {
            $ics .= "ATTENDEE:mailto:{$attendee}\r\n";
        }
        $ics .= "END:VFREEBUSY\r\nEND:VCALENDAR\r\n";

        $result = $this->sabre($username, 'POST', '/calendars/'.$username.'/outbox', $ics, ['Content-Type' => 'text/calendar']);
        $this->assertSame(200, $result['status'], $result['body']);

        $dom = new \DOMDocument;
        $dom->loadXML($result['body']);
        $xpath = new \DOMXPath($dom);
        $xpath->registerNamespace('cal', 'urn:ietf:params:xml:ns:caldav');
        $xpath->registerNamespace('d', 'DAV:');

        $responses = [];
        foreach ($xpath->query('//cal:response') ?: [] as $node) {
            $href = trim((string) $xpath->evaluate('string(cal:recipient/d:href)', $node));
            $data = $xpath->query('cal:calendar-data', $node);
            $responses[$href] = [
                'status' => trim((string) $xpath->evaluate('string(cal:request-status)', $node)),
                'data' => $data !== false && $data->length > 0 ? (string) $data->item(0)?->textContent : null,
                'xml' => (string) $dom->saveXML($node),
            ];
        }

        return $responses;
    }

    /**
     * The response element with the recipient href removed, so an unknown
     * address and a non-colleague can be compared byte for byte.
     *
     * @param  array{status: string, data: string|null, xml: string}  $response
     */
    private function withoutHref(array $response): string
    {
        return (string) preg_replace('#<d:href>[^<]*</d:href>#', '<d:href/>', $response['xml']);
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body, array $headers = []): array
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-outside-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        // A new DAV request: request-scoped state (the colleague memo) starts empty.
        $this->app->forgetScopedInstances();

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth] + $headers, $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return ['status' => $e->getHTTPCode(), 'body' => $e->getMessage()];
        }
        $status = $response->getStatus();

        return ['status' => is_int($status) ? $status : 500, 'body' => (string) $response->getBodyAsString()];
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
