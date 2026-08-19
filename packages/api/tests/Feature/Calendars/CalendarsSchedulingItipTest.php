<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Local iTIP on JMAP/REST event writes (Task #483): inbox + tentative copy, RSVP, cancel.
 */
final class CalendarsSchedulingItipTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
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

    public function test_jscalendar_owner_role_map_and_localhost_organizer_deliver(): void
    {
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');
        $this->seedDefaultCalendarFor('admin');

        $this->jmapAs('admin', [
            ['CalendarEvent/set', ['accountId' => 'admin', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Uit eten',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'admin@localhost',
                        'name' => 'Admin',
                        'roles' => ['owner' => true],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'name' => 'Carol',
                        'roles' => ['attendee' => true],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $this->assertNotSame([], $this->schedulingObjectsFor('principals/carol'));
    }

    public function test_username_attendee_and_missing_organizer_still_deliver(): void
    {
        $created = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Standup',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol',
                        'name' => 'Carol',
                        'roles' => ['attendee' => true],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame([], $this->schedulingObjectsFor('principals/carol'));
        $this->assertNotNull($this->findEventByUid('carol', $this->eventUid($eventId, 'bob')));
    }

    /**
     * Reverse of admin→wouter: a usable organizer mailbox must still deliver
     * local iTIP when the invitee's profile email is empty, invalid, or only a username.
     *
     * @return iterable<string, array{0: ?string, 1: string}>
     */
    public static function inviteeWithoutUsableEmailProvider(): iterable
    {
        yield 'empty email invited by username' => [null, 'admin'];
        yield 'invalid email invited by stored value' => ['not-an-email', 'not-an-email'];
        yield 'invalid email invited by username' => ['not-an-email', 'admin'];
        yield 'username stored as email' => ['admin', 'admin'];
        yield 'localhost email invited as mailto' => ['admin@localhost', 'admin@localhost'];
    }

    #[DataProvider('inviteeWithoutUsableEmailProvider')]
    public function test_valid_organizer_delivers_to_invitee_without_usable_email(
        ?string $inviteeEmail,
        string $attendeePayloadEmail,
    ): void {
        $this->seedWgwUser('wouter', email: 'wouter@woutervroege.nl', displayName: 'Wouter');
        $this->seedWgwUser('admin', displayName: 'Admin');
        $this->seedDefaultCalendarFor('wouter');
        $this->seedDefaultCalendarFor('admin');
        $admin = Principal::forUsername('admin');
        $this->assertNotNull($admin);
        $admin->email = $inviteeEmail;
        $admin->save();

        $created = $this->jmapAs('wouter', [
            ['CalendarEvent/set', ['accountId' => 'wouter', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Reverse invite',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'wouter@woutervroege.nl',
                        'name' => 'Wouter',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => $attendeePayloadEmail,
                        'name' => 'Admin',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);
        $this->assertSame([], $created->json('methodResponses.0.1.notCreated') ?? []);

        $inbox = $this->schedulingObjectsFor('principals/admin');
        $this->assertNotSame([], $inbox);
        $this->assertStringContainsString('METHOD:REQUEST', $inbox[0]['calendardata']);
        $this->assertNotNull($this->findEventByUid('admin', $this->eventUid($eventId, 'wouter')));

        $list = $this->withBearer($this->issueBearerTokenFor('admin'))
            ->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('REQUEST', $list[0]['method']);
        $this->assertSame('Reverse invite', $list[0]['title']);
        Mail::assertNothingSent();
    }

    public function test_organizer_reschedule_replaces_inbox_request_instead_of_stacking(): void
    {
        $eventId = $this->bobInvitesCarol();
        $this->assertCount(1, $this->schedulingObjectsFor('principals/carol'));

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-01-15T11:00:00Z',
                'end' => '2030-01-15T11:30:00Z',
            ]]], 'c0'],
        ])->assertOk();
        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-01-15T12:00:00Z',
                'end' => '2030-01-15T12:30:00Z',
            ]]], 'c0'],
        ])->assertOk();

        $this->assertCount(1, $this->schedulingObjectsFor('principals/carol'));
        $list = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('REQUEST', $list[0]['method']);
    }

    public function test_organizer_invite_writes_attendee_inbox_and_tentative_event_without_email(): void
    {
        $eventId = $this->bobInvitesCarol();

        $inbox = $this->schedulingObjectsFor('principals/carol');
        $this->assertNotSame([], $inbox);
        $this->assertStringContainsString('METHOD:REQUEST', $inbox[0]['calendardata']);
        $this->assertStringContainsString('carol@example.test', str_replace(["\r\n ", "\n "], '', $inbox[0]['calendardata']));

        $copy = $this->findEventByUid('carol', $this->eventUid($eventId, 'bob'));
        $this->assertNotNull($copy);
        $ics = is_string($copy->calendardata) ? $copy->calendardata : (string) $copy->calendardata;
        $this->assertStringContainsString('SUMMARY:Standup', $ics);
        $this->assertMatchesRegularExpression('/PARTSTAT=(NEEDS-ACTION|TENTATIVE)/i', $ics);

        Mail::assertNothingSent();
    }

    public function test_attendee_rsvp_updates_organizer_partstat(): void
    {
        $eventId = $this->bobInvitesCarol();
        $uid = $this->eventUid($eventId, 'bob');
        $carolCopy = $this->findEventByUid('carol', $uid);
        $this->assertNotNull($carolCopy);
        $carolEventId = pathinfo((string) $carolCopy->uri, PATHINFO_FILENAME);

        $this->jmapAs('carol', [
            ['CalendarEvent/set', ['accountId' => 'carol', 'update' => [$carolEventId => [
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'roles' => ['attendee'],
                        'participationStatus' => 'accepted',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $bobEvent = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ($bobEvent['participants'] ?? [] as $participant) {
            if (($participant['email'] ?? '') === 'carol@example.test') {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? ''));
            }
        }
        $this->assertContains('accepted', $partstats);
        Mail::assertNothingSent();
    }

    public function test_organizer_cancel_consumes_attendee_inbox(): void
    {
        $eventId = $this->bobInvitesCarol();
        $uid = $this->eventUid($eventId, 'bob');
        $this->assertNotSame([], $this->schedulingObjectsFor('principals/carol'));
        $this->assertNotNull($this->findEventByUid('carol', $uid));

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        $after = $this->schedulingObjectsFor('principals/carol');
        $this->assertFalse(
            collect($after)->contains(fn (array $row): bool => str_contains($row['calendardata'], 'METHOD:CANCEL')),
        );
        $this->assertFalse(
            collect($after)->contains(fn (array $row): bool => str_contains((string) $row['calendardata'], $uid)),
        );
        $this->assertNull($this->findEventByUid('carol', $uid));
        Mail::assertNothingSent();
    }

    public function test_caldav_put_still_delivers_local_invite(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:caldav-itip-1\r\nSUMMARY:CalDAV Invite\r\n"
            ."DTSTART:20300101T100000Z\r\nDTEND:20300101T110000Z\r\n"
            ."ORGANIZER;CN=Bob:mailto:bob@example.test\r\n"
            ."ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";

        $status = $this->sabrePut('bob', '/calendars/bob/default/caldav-itip-1.ics', $ics);
        $this->assertContains($status, [201, 204], 'CalDAV PUT of an invite must succeed');
        $this->assertNotSame([], $this->schedulingObjectsFor('principals/carol'));
    }

    public function test_organizer_cannot_write_attendee_schedule_inbox_over_caldav(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:acl-1\r\nDTSTART:20300101T100000Z\r\nDTEND:20300101T110000Z\r\nSUMMARY:Nope\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $status = $this->sabrePut('bob', '/calendars/carol/inbox/acl-1.ics', $ics);
        $this->assertContains($status, [401, 403, 404]);
        $this->assertSame([], $this->schedulingObjectsFor('principals/carol'));
    }

    private function sabrePut(string $username, string $path, string $body): int
    {
        $dataDir = sys_get_temp_dir().'/wgw-sabre-itip-'.uniqid('', true);
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

    private function bobInvitesCarol(): string
    {
        $created = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Standup',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'name' => 'Bob',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'name' => 'Carol',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);

        return $eventId;
    }

    private function eventUid(string $eventId, string $username): string
    {
        $event = $this->jmapAs($username, [
            ['CalendarEvent/get', ['accountId' => $username, 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $uid = (string) ($event['uid'] ?? '');
        $this->assertNotSame('', $uid);

        return $uid;
    }

    /**
     * @return list<array{calendardata: string, uri: string}>
     */
    private function schedulingObjectsFor(string $principalUri): array
    {
        $rows = DB::connection('wgw')->table('schedulingobjects')
            ->where('principaluri', $principalUri)
            ->get(['calendardata', 'uri']);

        $out = [];
        foreach ($rows as $row) {
            $data = $row->calendardata;
            $out[] = [
                'calendardata' => is_string($data) ? $data : (string) $data,
                'uri' => (string) $row->uri,
            ];
        }

        return $out;
    }

    private function findEventByUid(string $username, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('uid', $uid)
            ->whereHas('calendar.instances', function ($query) use ($username): void {
                $query->where('principaluri', 'principals/'.$username);
            })
            ->first();
    }
}
