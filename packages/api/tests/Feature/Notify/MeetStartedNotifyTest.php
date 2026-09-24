<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Notify\MeetStartedNotify;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * First room activation → meet.started suite inbox (Task #799).
 */
final class MeetStartedNotifyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const ORIGIN = 'https://workspace.test';

    private const ROOM = 'abcd-efgh-jklm';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        config(['app.url' => self::ORIGIN]);
    }

    public function test_first_activation_notifies_roster_once(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => [
                'bob' => ['mayWriteAll' => true],
                'carol' => ['mayWriteAll' => true],
            ],
        ])->assertOk();

        // meet.started is gated on MeetReservation::activated_at (null→set).
        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => $channelId,
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();

        Notification::query()->delete();
        $this->asUser('alice')->postJson('/api/v1/rooms/'.$channelId.'/participants', [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
        ])->assertOk();

        $this->assertSame(2, Notification::query()->where('action', 'started')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'started')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'started')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'alice')->where('action', 'started')->count());

        $bob = Notification::query()->where('principal', 'bob')->where('action', 'started')->first();
        $this->assertNotNull($bob);
        $this->assertSame('Alice started a meeting', $bob->title);
        $this->assertSame(MeetStartedNotify::dedupeKey($channelId), (string) $bob->tag);
        $this->assertStringStartsWith('/meet/', (string) $bob->navigate);

        $this->asUser('bob')->postJson('/api/v1/rooms/'.$channelId.'/participants', [
            'peerId' => 'bob-peer2',
            'name' => 'Bob',
        ])->assertOk();

        $this->assertSame(2, Notification::query()->where('action', 'started')->count());
    }

    public function test_calendar_internal_attendee_notified_external_skipped(): void
    {
        $href = self::ORIGIN.'/meet/meetings/'.self::ROOM;
        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['m' => [
                'calendarIds' => ['default' => true],
                'title' => 'Meet link call',
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T10:30:00Z',
                'links' => [
                    'conf' => [
                        '@type' => 'Link',
                        'href' => $href,
                        'rel' => 'describedby',
                    ],
                ],
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'name' => 'Carol',
                        'roles' => ['attendee'],
                        'participationStatus' => 'accepted',
                    ],
                    'ext' => [
                        '@type' => 'Participant',
                        'email' => 'guest@elsewhere.test',
                        'name' => 'External Guest',
                        'roles' => ['attendee'],
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $this->asUser('bob')->postJson('/api/v1/meetings/rooms', [
            'room' => self::ROOM,
            'ownerPrincipal' => 'u:bob',
        ])->assertCreated();

        Notification::query()->delete();

        $this->asUser('bob')->postJson('/api/v1/rooms/'.self::ROOM.'/participants', [
            'peerId' => 'bob-host',
            'name' => 'Bob',
        ])->assertOk();

        $this->assertSame(1, Notification::query()->where('action', 'started')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'started')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('action', 'started')->count());

        $carol = Notification::query()->where('principal', 'carol')->where('action', 'started')->first();
        $this->assertNotNull($carol);
        $this->assertSame('Bob started a meeting', $carol->title);
        $this->assertSame(self::ROOM, $carol->body);
        $this->assertSame('/meet/meetings/'.self::ROOM, $carol->navigate);
    }

    private function asUser(string $username)
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }
}
