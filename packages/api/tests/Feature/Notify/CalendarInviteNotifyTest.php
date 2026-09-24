<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Notify\CalendarInviteNotify;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarInviteNotifyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_invitee_gets_tray_row_and_organizer_does_not(): void
    {
        $this->bobInvitesCarol();

        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'invite')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('action', 'invite')->count());

        $row = Notification::query()->where('principal', 'carol')->where('action', 'invite')->first();
        $this->assertNotNull($row);
        $this->assertSame('Bob invited you to Standup', $row->title);
        $this->assertSame(CalendarInviteNotify::NAVIGATE, $row->navigate);
        $this->assertStringStartsWith('calendar.invite:', (string) $row->tag);
        $this->assertStringContainsString('calendar.invite:', (string) $row->dedupe_key);
        $this->assertStringContainsString('10:00', (string) $row->body);
        $this->assertStringContainsString('15 Jan', (string) $row->body);
        $this->assertIsArray($row->data);
        $this->assertSame('Bob', $row->data['actor'] ?? null);
        $this->assertSame('Standup', $row->data['summary'] ?? null);
    }

    public function test_reschedule_supersedes_same_dedupe_row(): void
    {
        $eventId = $this->bobInvitesCarol();
        $before = Notification::query()->where('principal', 'carol')->where('action', 'invite')->first();
        $this->assertNotNull($before);
        $beforeId = $before->id;
        $beforeStart = (string) ($before->data['start'] ?? '');

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-01-15T12:00:00Z',
                'end' => '2030-01-15T12:30:00Z',
            ]]], 'c0'],
        ])->assertOk();

        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'invite')->count());
        $after = Notification::query()->where('principal', 'carol')->where('action', 'invite')->first();
        $this->assertNotNull($after);
        $this->assertSame($beforeId, $after->id);
        $this->assertNotSame($beforeStart, (string) ($after->data['start'] ?? ''));
        $this->assertNull($after->read_at);
    }

    public function test_cancel_clears_tray_invite_row(): void
    {
        $eventId = $this->bobInvitesCarol();
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'invite')->count());

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        $this->assertSame(0, Notification::query()->where('principal', 'carol')->where('action', 'invite')->count());
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
}
