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
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Cache;
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
        Cache::flush();
        $this->enableMailSubmit();
    }

    public function test_external_attendee_receives_imip_and_not_local_inbox(): void
    {
        $eventId = $this->bobInvitesExternal();

        $raw = $this->rawRsvpTokenFromLatestRequest();
        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);
        $this->assertSame('guest@elsewhere.test', (string) $token->attendee_email);
        $this->assertSame('bob', (string) $token->organizer_username);
        $this->assertNotSame($raw, (string) $token->token_hash);
        $this->assertSame(CalendarRsvpToken::hashRaw($raw), (string) $token->token_hash);
        $this->assertSame(0, (int) DB::connection('wgw')->table('schedulingobjects')->count());

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REQUEST'
                && str_contains((string) $mail->outbound->htmlBody, '<p>')
                && str_contains((string) $mail->outbound->calendarIcs, 'METHOD:REQUEST')
                && $mail->attachments() !== [];
        });

        $this->getJson('/api/v1/calendar/rsvp/'.$raw)
            ->assertOk()
            ->assertJsonPath('attendeeEmail', 'guest@elsewhere.test')
            ->assertJsonPath('title', 'External Sync')
            ->assertJsonPath('participationStatus', 'needs-action');

        $this->assertNotSame('', $eventId);
    }

    public function test_public_rsvp_accepted_updates_organizer_and_is_idempotent(): void
    {
        $eventId = $this->bobInvitesExternal();
        $raw = $this->rawRsvpTokenFromLatestRequest();

        $this->postJson('/api/v1/calendar/rsvp/'.$raw, [
            'participationStatus' => 'accepted',
        ])->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertContains('accepted', $this->guestPartstats($eventId));

        $this->postJson('/api/v1/calendar/rsvp/'.$raw, [
            'participationStatus' => 'accepted',
        ])->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertSame(['accepted'], $this->guestPartstats($eventId));
    }

    public function test_public_rsvp_unknown_and_expired_tokens_are_not_found(): void
    {
        $this->getJson('/api/v1/calendar/rsvp/missingtoken')->assertNotFound();
        $this->postJson('/api/v1/calendar/rsvp/missingtoken', [
            'participationStatus' => 'accepted',
        ])->assertNotFound();

        $eventId = $this->bobInvitesExternal();
        $raw = $this->rawRsvpTokenFromLatestRequest();
        $token = CalendarRsvpToken::query()->first();
        $this->assertNotNull($token);
        $token->expires_at = time() - 10;
        $token->save();

        $this->getJson('/api/v1/calendar/rsvp/'.$raw)->assertNotFound();
        $this->postJson('/api/v1/calendar/rsvp/'.$raw, [
            'participationStatus' => 'declined',
        ])->assertNotFound();
        $this->assertSame(['needs-action'], $this->guestPartstats($eventId));
    }

    public function test_public_rsvp_rate_limits_repeated_attempts(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->getJson('/api/v1/calendar/rsvp/missingtoken')->assertNotFound();
        }

        $this->getJson('/api/v1/calendar/rsvp/missingtoken')->assertStatus(429);
    }

    public function test_organizer_cancel_invalidates_rsvp_token(): void
    {
        $eventId = $this->bobInvitesExternal();
        $raw = $this->rawRsvpTokenFromLatestRequest();
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
        $this->getJson('/api/v1/calendar/rsvp/'.$raw)->assertNotFound();
        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'CANCEL'
                && str_contains((string) $mail->outbound->calendarIcs, 'METHOD:CANCEL');
        });
    }

    public function test_description_only_change_does_not_schedule_imip(): void
    {
        $eventId = $this->bobInvitesExternal();
        Mail::assertSent(OutboundMessageMail::class, 1);
        $raw = $this->rawRsvpTokenFromLatestRequest();
        $hash = (string) CalendarRsvpToken::query()->where('expires_at', '>', time())->value('token_hash');

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'description' => 'Bring slides',
            ]]], 'c0'],
        ])->assertOk();

        Mail::assertSent(OutboundMessageMail::class, 1);
        $this->assertSame(1, CalendarRsvpToken::query()->where('expires_at', '>', time())->count());
        $this->assertSame($hash, (string) CalendarRsvpToken::query()->where('expires_at', '>', time())->value('token_hash'));
        $this->getJson('/api/v1/calendar/rsvp/'.$raw)->assertOk();
    }

    public function test_significant_time_change_schedules_imip_and_revokes_old_token(): void
    {
        $eventId = $this->bobInvitesExternal();
        $first = $this->rawRsvpTokenFromLatestRequest();

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-02-01T11:00:00Z',
                'end' => '2030-02-01T11:30:00Z',
            ]]], 'c0'],
        ])->assertOk();

        Mail::assertSent(OutboundMessageMail::class, 2);
        $second = $this->rawRsvpTokenFromLatestRequest();
        $this->assertNotSame($first, $second);
        $this->getJson('/api/v1/calendar/rsvp/'.$first)->assertNotFound();
        $this->getJson('/api/v1/calendar/rsvp/'.$second)->assertOk();
        $this->assertGreaterThan(0, $this->eventSequence($eventId));
    }

    public function test_local_attendee_reply_to_external_organizer_is_reply_not_invite(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:ext-org-1\r\nSUMMARY:External Organizer\r\n"
            ."DTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nSEQUENCE:2\r\n"
            ."ORGANIZER;CN=Guest Org:mailto:org@elsewhere.test\r\n"
            ."ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('carol', 'ext-org-1.ics', $ics);

        $this->jmapAs('carol', [
            ['CalendarEvent/set', ['accountId' => 'carol', 'update' => ['ext-org-1' => [
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'org@elsewhere.test',
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

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REPLY'
                && str_contains(strtolower($mail->outbound->textBody), 'accepted')
                && ! str_contains($mail->outbound->textBody, '/calendar/rsvp/')
                && str_contains((string) $mail->outbound->calendarIcs, 'METHOD:REPLY')
                && $mail->attachments() !== [];
        });
        $this->assertSame(0, CalendarRsvpToken::query()->where('expires_at', '>', time())->count());
        $this->assertSame(2, $this->eventSequence('ext-org-1', 'carol'));
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
        Mail::assertNothingSent();
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

    private function eventSequence(string $eventId, string $username = 'bob'): int
    {
        $event = $this->jmapAs($username, [
            ['CalendarEvent/get', ['accountId' => $username, 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        return (int) ($event['sequence'] ?? 0);
    }

    private function rawRsvpTokenFromLatestRequest(): string
    {
        $sent = Mail::sent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REQUEST';
        });
        $this->assertFalse($sent->isEmpty(), 'expected a REQUEST iMIP message');
        $mail = $sent->last();
        $this->assertInstanceOf(OutboundMessageMail::class, $mail);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $mail->outbound->textBody, $match));

        return $match[1];
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
