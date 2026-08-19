<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Scheduling inbox REST (Task #484): list, RSVP, dismiss, cross-user 404.
 */
final class CalendarsSchedulingNotificationsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
    }

    public function test_invitees_lists_instance_users_with_email(): void
    {
        $body = $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/invitees')
            ->assertOk()
            ->assertJsonStructure(['list', 'canSubmitEmail']);
        $this->assertIsBool($body->json('canSubmitEmail'));
        $list = $body->json('list');

        $this->assertIsArray($list);
        $emails = array_map(static fn (array $row): string => (string) $row['email'], $list);
        $this->assertContains('bob@example.test', $emails);
        $this->assertContains('carol@example.test', $emails);
    }

    public function test_invitees_include_localhost_email_and_username_only_users(): void
    {
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');
        $this->seedWgwUser('bare', displayName: 'Bare');
        $bare = Principal::forUsername('bare');
        $this->assertNotNull($bare);
        $bare->email = null;
        $bare->save();

        $list = $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/invitees')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $byUsername = [];
        foreach ($list as $row) {
            $byUsername[(string) $row['username']] = (string) $row['email'];
        }
        $this->assertSame('admin@localhost', $byUsername['admin'] ?? null);
        $this->assertSame('bare', $byUsername['bare'] ?? null);
    }

    public function test_attendee_lists_own_invite_notification(): void
    {
        $this->bobInvitesCarol();

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');

        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('REQUEST', $list[0]['method']);
        $this->assertSame('Standup', $list[0]['title']);
        $this->assertSame('bob@example.test', $list[0]['organizerEmail']);
        $this->assertSame('needs-action', $list[0]['participationStatus']);
        $this->assertNotSame('', $list[0]['id']);
        $this->assertNotSame('', $list[0]['uid']);
        $this->assertNotNull($list[0]['eventId']);
    }

    public function test_respond_accepted_updates_organizer_and_clears_inbox(): void
    {
        $eventId = $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);

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

    public function test_dismiss_removes_inbox_without_reply(): void
    {
        $eventId = $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('carol')->deleteJson('/api/v1/calendars/scheduling/notifications/'.$notificationId)
            ->assertNoContent();

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);

        $bobEvent = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ($bobEvent['participants'] ?? [] as $participant) {
            if (($participant['email'] ?? '') === 'carol@example.test') {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? 'needs-action'));
            }
        }
        $this->assertContains('needs-action', $partstats);
    }

    public function test_other_users_notification_id_is_not_found(): void
    {
        $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);

        $this->asUser('bob')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertNotFound();

        $this->asUser('bob')->deleteJson('/api/v1/calendars/scheduling/notifications/'.$notificationId)
            ->assertNotFound();

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'list');
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

    private function asUser(string $username): self
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
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

    private function carolNotificationId(): string
    {
        $id = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.id');
        $this->assertNotSame('', $id);

        return $id;
    }
}
