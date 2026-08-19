<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarRsvpToken;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarImipService;
use App\Services\Calendars\CalendarSchedulingService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsSchedulingImipTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
        $this->enableMailSubmit();
    }

    public function test_external_attendee_receives_imip_and_not_local_inbox(): void
    {
        $eventId = $this->bobInvitesExternal();

        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);
        $this->assertSame('guest@elsewhere.test', (string) $token->attendee_email);
        $this->assertSame('bob', (string) $token->organizer_username);
        $this->assertNotSame('', (string) $token->token);
        $this->assertSame(0, (int) DB::connection('wgw')->table('schedulingobjects')->count());

        $this->getJson('/api/v1/calendar/rsvp/'.$token->token)
            ->assertOk()
            ->assertJsonPath('attendeeEmail', 'guest@elsewhere.test')
            ->assertJsonPath('title', 'External Sync')
            ->assertJsonPath('participationStatus', 'needs-action');

        $this->assertNotSame('', $eventId);
    }

    public function test_public_rsvp_accepted_updates_organizer_and_is_idempotent(): void
    {
        $eventId = $this->bobInvitesExternal();
        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);

        $this->postJson('/api/v1/calendar/rsvp/'.$token->token, [
            'participationStatus' => 'accepted',
        ])->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertContains('accepted', $this->guestPartstats($eventId));

        $this->postJson('/api/v1/calendar/rsvp/'.$token->token, [
            'participationStatus' => 'accepted',
        ])->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertSame(['accepted'], $this->guestPartstats($eventId));
    }

    public function test_public_rsvp_unknown_and_expired_tokens_are_not_found(): void
    {
        $this->getJson('/api/v1/calendar/rsvp/missing-token')->assertNotFound();
        $this->postJson('/api/v1/calendar/rsvp/missing-token', [
            'participationStatus' => 'accepted',
        ])->assertNotFound();

        $eventId = $this->bobInvitesExternal();
        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);
        $token->expires_at = time() - 10;
        $token->save();

        $this->getJson('/api/v1/calendar/rsvp/'.$token->token)->assertNotFound();
        $this->postJson('/api/v1/calendar/rsvp/'.$token->token, [
            'participationStatus' => 'declined',
        ])->assertNotFound();
        $this->assertSame(['needs-action'], $this->guestPartstats($eventId));
    }

    public function test_organizer_cancel_invalidates_rsvp_token(): void
    {
        $eventId = $this->bobInvitesExternal();
        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        $token->refresh();
        $this->assertLessThan(time(), (int) $token->expires_at);
        $this->assertSame(
            0,
            CalendarRsvpToken::query()->where('expires_at', '>', time())->count(),
        );
        $this->getJson('/api/v1/calendar/rsvp/'.$token->token)->assertNotFound();
    }

    public function test_external_attendee_is_stored_without_token_when_mail_cannot_submit(): void
    {
        $this->app->instance(
            MailDeliveryTransportResolver::class,
            new MailDeliveryTransportResolver(
                phpMailProbe: static fn (): bool => false,
                sendmailProbe: static fn (): bool => false,
            ),
        );
        $this->app->forgetInstance(CalendarImipService::class);
        $this->app->forgetInstance(CalendarSchedulingService::class);
        $this->app->forgetInstance(CalendarEventRepository::class);

        $eventId = $this->bobInvitesExternal();
        $this->assertNotSame('', $eventId);
        $this->assertSame(0, CalendarRsvpToken::query()->count());
        $this->assertSame(['needs-action'], $this->guestPartstats($eventId));
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

    private function bobInvitesExternal(): string
    {
        $created = $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'External Sync',
                'start' => '2030-02-01T10:00:00Z',
                'end' => '2030-02-01T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'roles' => ['owner'],
                    ],
                    'ext' => [
                        '@type' => 'Participant',
                        'email' => 'guest@elsewhere.test',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]],
            'c0',
        ]])->assertOk();

        return (string) $created->json('methodResponses.0.1.created.inv.id');
    }

    /**
     * @return list<string>
     */
    private function guestPartstats(string $eventId): array
    {
        $event = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ($event['participants'] ?? [] as $participant) {
            if (($participant['email'] ?? '') === 'guest@elsewhere.test') {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? ''));
            }
        }

        return $partstats;
    }

    private function enableMailSubmit(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'calendar@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
        $this->app->instance(
            MailDeliveryTransportResolver::class,
            new MailDeliveryTransportResolver(
                phpMailProbe: static fn (): bool => true,
                sendmailProbe: static fn (): bool => true,
            ),
        );
    }
}
