<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\CalendarObject;
use App\Models\MeetReservation;
use App\Models\Principal;
use App\Models\SchedulingObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk A: links ↔ conference write-set, iMIP/inbox URL, ICS-write hook.
 */
final class CalendarsMeetLinkTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const ORIGIN = 'https://workspace.test';

    private const ROOM = 'abcd-efgh-ijkl';

    private const OTHER_ROOM = 'mnop-qrst-uvwx';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        config(['app.url' => self::ORIGIN]);
    }

    public function test_jmap_create_patch_and_this_instance_persist_conference_write_set(): void
    {
        $href = $this->guestHref(self::ROOM);
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => array_merge(
                $this->sampleCalendarEventPayload(),
                [
                    'uid' => 'meet-create-1',
                    'title' => 'Meet create',
                    'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
                ],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');
        $this->assertNotSame('', $eventId);
        $this->assertSame(
            $href,
            $this->jmapAs('bob', [
                ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g0'],
            ])->assertOk()->json('methodResponses.0.1.list.0.links.link1.href'),
        );
        $this->assertConferenceWriteSet($this->storedIcs($eventId), $href);

        $patchedHref = $this->guestHref(self::OTHER_ROOM);
        $patched = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'links' => ['link1' => ['@type' => 'Link', 'href' => $patchedHref]],
            ]]], 'u0'],
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g1'],
        ])->assertOk();
        $this->assertSame($patchedHref, $patched->json('methodResponses.1.1.list.0.links.link1.href'));
        $this->assertConferenceWriteSet($this->storedIcs($eventId), $patchedHref);

        $seriesId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['s' => [
                'calendarIds' => ['default' => true],
                'uid' => 'meet-series-1',
                'title' => 'Series',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'recurrenceRules' => [['@type' => 'RecurrenceRule', 'frequency' => 'weekly']],
                'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
            ]]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.created.s.id');

        $overrideHref = $this->guestHref(self::OTHER_ROOM);
        $override = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$seriesId => [
                'recurrenceOverrides' => [
                    '2030-01-22T10:00:00Z' => [
                        'end' => '2030-01-22T11:00:00Z',
                        'links' => ['link1' => ['@type' => 'Link', 'href' => $overrideHref]],
                    ],
                ],
            ]]], 'u1'],
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$seriesId]], 'g2'],
        ])->assertOk();

        $this->assertSame(
            $overrideHref,
            $override->json('methodResponses.1.1.list.0.recurrenceOverrides.2030-01-22T10:00:00Z.links.link1.href'),
        );
        $seriesIcs = $this->storedIcs($seriesId);
        $this->assertStringContainsString('RRULE:FREQ=WEEKLY', $seriesIcs);
        $this->assertStringContainsString('RECURRENCE-ID:20300122T100000Z', $seriesIcs);
        $this->assertConferenceWriteSet($seriesIcs, $overrideHref);
        $this->assertStringNotContainsString('X-MICROSOFT-SKYPETEAMSMEETINGURL', str_replace("\r\n ", '', $seriesIcs));
    }

    public function test_imip_request_and_inbox_notification_include_url(): void
    {
        $href = $this->guestHref(self::ROOM);
        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Invite with Meet',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'roles' => ['owner'],
                        'participationStatus' => 'accepted',
                    ],
                    'att' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $row = SchedulingObject::query()->where('principaluri', 'principals/carol')->first();
        $this->assertNotNull($row);
        $inboxIcs = is_string($row->calendardata) ? $row->calendardata : (string) $row->calendardata;
        $this->assertConferenceWriteSet($inboxIcs, $href);

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $this->assertNotSame([], $list);
        $this->assertSame($href, $list[0]['url'] ?? null);
    }

    public function test_jmap_and_caldav_reschedule_move_expires_at(): void
    {
        $href = $this->guestHref(self::ROOM);
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => [
                'calendarIds' => ['default' => true],
                'title' => 'Moving meet',
                'start' => '2030-01-01T10:00:00Z',
                'end' => '2030-01-01T11:00:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $first = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($first);
        $this->assertSame(
            '2030-01-08T11:00:00+00:00',
            $this->iso($first->expires_at),
        );

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T11:00:00Z',
            ]]], 'u0'],
        ])->assertOk();

        $moved = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($moved);
        $this->assertSame(
            '2030-01-22T11:00:00+00:00',
            $this->iso($moved->expires_at),
        );

        $uri = str_ends_with($eventId, '.ics') ? $eventId : $eventId.'.ics';
        $status = $this->sabrePut('bob', '/calendars/bob/default/'.$uri, $this->eventIcs(
            'caldav-move',
            '2030-09-15T10:00:00Z',
            '2030-09-15T11:00:00Z',
            $href,
        ));
        $this->assertContains($status, [201, 204]);

        $caldavMoved = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($caldavMoved);
        $this->assertSame(
            '2030-09-22T11:00:00+00:00',
            $this->iso($caldavMoved->expires_at),
        );
    }

    public function test_caldav_put_creates_reservation_with_put_principal_created_by(): void
    {
        $href = $this->guestHref(self::ROOM);
        $status = $this->sabrePut(
            'bob',
            '/calendars/bob/default/inbound-meet.ics',
            $this->eventIcs('inbound-meet', '2030-03-01T10:00:00Z', '2030-03-01T11:00:00Z', $href),
        );
        $this->assertContains($status, [201, 204]);

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('u:bob', $row->created_by);
        $this->assertSame('u:bob', $row->owner_principal);
        $this->assertSame('2030-03-08T11:00:00+00:00', $this->iso($row->expires_at));
    }

    public function test_blur_draft_then_save_upgrades_clock(): void
    {
        $href = $this->guestHref(self::ROOM);
        MeetReservation::query()->create([
            'id' => self::ROOM,
            'owner_principal' => 'u:bob',
            'created_by' => 'u:bob',
            'expires_at' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 days'),
        ]);

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => [
                'calendarIds' => ['default' => true],
                'title' => 'Far future after draft',
                'start' => '2031-06-01T10:00:00Z',
                'end' => '2031-06-01T12:00:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
            ]]], 'c0'],
        ])->assertOk();

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('u:bob', $row->created_by);
        $this->assertSame('2031-06-08T12:00:00+00:00', $this->iso($row->expires_at));

        $seriesHref = $this->guestHref(self::OTHER_ROOM);
        MeetReservation::query()->create([
            'id' => self::OTHER_ROOM,
            'owner_principal' => 'u:bob',
            'created_by' => 'u:bob',
            'expires_at' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 days'),
        ]);
        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['s' => [
                'calendarIds' => ['default' => true],
                'title' => 'Series after draft',
                'start' => '2031-06-01T10:00:00Z',
                'end' => '2031-06-01T11:00:00Z',
                'recurrenceRules' => [['@type' => 'RecurrenceRule', 'frequency' => 'weekly']],
                'links' => ['link1' => ['@type' => 'Link', 'href' => $seriesHref]],
            ]]], 'c1'],
        ])->assertOk();

        $series = MeetReservation::query()->find(self::OTHER_ROOM);
        $this->assertNotNull($series);
        $this->assertNull($series->expires_at);
    }

    public function test_mapping_only_get_does_not_reserve_and_non_wgw_skips_reserve(): void
    {
        $href = $this->guestHref(self::ROOM);
        $this->seedEventViaPdo('bob', 'mapped-only.ics', $this->eventIcs(
            'mapped-only',
            '2030-04-01T10:00:00Z',
            '2030-04-01T11:00:00Z',
            $href,
        ));

        $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => ['mapped-only']], 'g0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.list.0.links.link1.href', $href);

        $this->assertNull(MeetReservation::query()->find(self::ROOM));

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['z' => [
                'calendarIds' => ['default' => true],
                'title' => 'Zoom only',
                'start' => '2030-04-02T10:00:00Z',
                'end' => '2030-04-02T11:00:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => 'https://zoom.example/j/123']],
            ]]], 'c0'],
        ])->assertOk();

        $this->assertSame(0, MeetReservation::query()->count());
    }

    public function test_inbound_reserve_keeps_existing_owner(): void
    {
        MeetReservation::query()->create([
            'id' => self::ROOM,
            'owner_principal' => 'u:alice',
            'created_by' => 'u:alice',
            'expires_at' => new DateTimeImmutable('2030-01-10T11:00:00Z'),
        ]);

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => [
                'calendarIds' => ['default' => true],
                'title' => 'Pasted ad-hoc',
                'start' => '2030-02-01T10:00:00Z',
                'end' => '2030-02-01T11:00:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => $this->guestHref(self::ROOM)]],
            ]]], 'c0'],
        ])->assertOk();

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('u:alice', $row->owner_principal);
        $this->assertSame('u:alice', $row->created_by);
        $this->assertSame('2030-02-08T11:00:00+00:00', $this->iso($row->expires_at));
    }

    public function test_group_calendar_reserve_uses_group_owner_and_writer_created_by(): void
    {
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
        app(UserCalendarCollectionsProvisioner::class)
            ->ensureForGroupPrincipal('principals/groups/team', 'Team');

        $calendarId = CalendarCollectionUris::groupCalendarApiId('team');
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['e' => [
                'calendarIds' => [$calendarId => true],
                'title' => 'Group meet',
                'start' => '2030-05-01T10:00:00Z',
                'end' => '2030-05-01T11:00:00Z',
                'links' => ['link1' => ['@type' => 'Link', 'href' => $this->guestHref(self::ROOM)]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');
        $this->assertNotSame('', $eventId);

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertSame('groups/team', $row->owner_principal);
        $this->assertSame('u:bob', $row->created_by);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function asUser(string $username): self
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }

    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function guestHref(string $room): string
    {
        return self::ORIGIN.'/meet/guest?room='.$room;
    }

    private function assertConferenceWriteSet(string $ics, string $href): void
    {
        $defolded = str_replace("\r\n ", '', $ics);
        $this->assertMatchesRegularExpression(
            '/URL(?:;[^:\\r\\n]*)?:'.preg_quote($href, '/').'/',
            $defolded,
        );
        $this->assertStringContainsString('CONFERENCE;', $defolded);
        $this->assertStringContainsString($href, $defolded);
        $this->assertStringContainsString('X-GOOGLE-CONFERENCE:'.$href, $defolded);
        $this->assertStringNotContainsString('X-MICROSOFT-SKYPETEAMSMEETINGURL', $defolded);
    }

    private function storedIcs(string $eventId): string
    {
        $uri = str_ends_with($eventId, '.ics') ? $eventId : $eventId.'.ics';
        $stored = CalendarObject::query()->where('uri', $uri)->first();
        $this->assertNotNull($stored);

        return is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
    }

    private function eventIcs(string $uid, string $start, string $end, string $href): string
    {
        $startIcs = str_replace(['-', ':'], '', $start);
        $endIcs = str_replace(['-', ':'], '', $end);

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Inbound\r\n"
            ."DTSTART:{$startIcs}\r\nDTEND:{$endIcs}\r\n"
            ."URL:{$href}\r\nCONFERENCE;VALUE=URI;FEATURE=VIDEO:{$href}\r\n"
            ."X-GOOGLE-CONFERENCE:{$href}\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function iso(?DateTimeInterface $value): ?string
    {
        return $value?->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:sP');
    }

    private function sabrePut(string $username, string $path, string $body): int
    {
        $dataDir = sys_get_temp_dir().'/wgw-sabre-meet-link-'.uniqid('', true);
        mkdir($dataDir, 0775, true);
        config(['wgw.data_dir' => $dataDir]);

        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest('PUT', $path, [
            'Authorization' => $auth,
            'Content-Type' => 'text/calendar',
        ], $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return $e->getHTTPCode();
        } catch (\Throwable) {
            $status = $response->getStatus();

            return is_int($status) ? $status : 500;
        }

        $status = $response->getStatus();

        return is_int($status) ? $status : 500;
    }
}
