<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarRsvpToken;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarImipService;
use App\Services\Calendars\CalendarSchedulingService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapCapabilitySet;
use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Cache\RateLimiter;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Sabre\VObject\ITip\Message;
use Sabre\VObject\Reader;
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

    public function test_101st_invite_in_an_hour_is_not_sent(): void
    {
        $sent = [];
        $throttled = [];
        Log::listen(function (MessageLogged $event) use (&$sent, &$throttled): void {
            if ($event->message === 'imip.sent') {
                $sent[] = $event->context;
            }
            if ($event->message === 'imip.throttled') {
                $throttled[] = $event->context;
            }
        });

        $imip = $this->app->make(CalendarImipService::class);
        for ($i = 1; $i <= 100; $i++) {
            $imip->deliver('bob', $this->externalRequest('guest'.$i.'@elsewhere.test', 'hour-'.$i));
        }

        Mail::assertSent(OutboundMessageMail::class, 100);
        $this->assertCount(100, $sent);
        $this->assertSame('bob', $sent[0]['organizer'] ?? null);
        $this->assertSame('elsewhere.test', $sent[0]['to_domain'] ?? null);
        $encoded = json_encode($sent[0]);
        $this->assertIsString($encoded);
        $this->assertStringNotContainsString('BEGIN:VCALENDAR', $encoded);
        $this->assertStringNotContainsString('guest1@elsewhere.test', $encoded);
        $this->assertStringNotContainsString('You are invited', $encoded);

        $imip->deliver('bob', $this->externalRequest('overflow@elsewhere.test', 'hour-101'));

        Mail::assertSent(OutboundMessageMail::class, 100);
        $this->assertCount(1, $throttled);
        $this->assertSame('bob', $throttled[0]['organizer'] ?? null);
        $this->assertSame(100, CalendarRsvpToken::query()->count());
    }

    public function test_daily_cap_skips_the_send_before_a_token_is_issued(): void
    {
        $limiter = $this->app->make(RateLimiter::class);
        for ($i = 0; $i < 300; $i++) {
            $limiter->hit('imip:user-day:bob', 86400);
        }

        $this->app->make(CalendarImipService::class)->deliver(
            'bob',
            $this->externalRequest('guest@elsewhere.test', 'day-cap'),
        );

        Mail::assertNothingSent();
        $this->assertSame(0, CalendarRsvpToken::query()->count());
    }

    public function test_hourly_limit_setting_blocks_the_next_invite(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_HOURLY_LIMIT, 1);
        $imip = $this->app->make(CalendarImipService::class);

        $imip->deliver('bob', $this->externalRequest('one@elsewhere.test', 'limit-1'));
        $imip->deliver('bob', $this->externalRequest('two@elsewhere.test', 'limit-2'));

        Mail::assertSent(OutboundMessageMail::class, 1);
        $this->assertSame(1, CalendarRsvpToken::query()->count());
    }

    public function test_external_invites_disabled_skips_mail_and_keeps_local_scheduling(): void
    {
        $disabled = [];
        Log::listen(function (MessageLogged $event) use (&$disabled): void {
            if ($event->message === 'imip.disabled') {
                $disabled[] = $event->context;
            }
        });
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);

        $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Mixed Sync',
                'start' => '2030-02-01T10:00:00Z',
                'end' => '2030-02-01T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'roles' => ['owner'],
                    ],
                    'local' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
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

        Mail::assertNothingSent();
        $this->assertGreaterThan(
            0,
            (int) DB::connection('wgw')->table('schedulingobjects')->where('principaluri', 'principals/carol')->count(),
        );
        $this->assertSame(0, CalendarRsvpToken::query()->count());
        $this->assertNotSame([], $disabled);
        $this->assertSame('bob', $disabled[0]['organizer'] ?? null);
        $encoded = json_encode($disabled[0]);
        $this->assertIsString($encoded);
        $this->assertStringNotContainsString('BEGIN:VCALENDAR', $encoded);
        $this->assertStringNotContainsString('guest@elsewhere.test', $encoded);
    }

    public function test_event_stops_external_mail_after_50_distinct_recipients(): void
    {
        $loggedCaps = [];
        Log::listen(function (MessageLogged $event) use (&$loggedCaps): void {
            if ($event->message === 'imip.attendee_cap') {
                $loggedCaps[] = $event->context;
            }
        });

        $participants = [
            'org' => [
                '@type' => 'Participant',
                'email' => 'bob@example.test',
                'roles' => ['owner'],
            ],
            'local' => [
                '@type' => 'Participant',
                'email' => 'carol@example.test',
                'roles' => ['attendee'],
                'expectReply' => true,
                'participationStatus' => 'needs-action',
            ],
        ];
        for ($i = 1; $i <= 51; $i++) {
            $participants['ext'.$i] = [
                '@type' => 'Participant',
                'email' => 'guest'.$i.'@elsewhere.test',
                'roles' => ['attendee'],
                'expectReply' => true,
                'participationStatus' => 'needs-action',
            ];
        }

        $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Wide Sync',
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T10:30:00Z',
                'participants' => $participants,
            ]]],
            'c0',
        ]])->assertOk();

        Mail::assertSent(OutboundMessageMail::class, 50);
        $this->assertGreaterThan(
            0,
            (int) DB::connection('wgw')->table('schedulingobjects')->where('principaluri', 'principals/carol')->count(),
        );
        $this->assertNotSame([], $loggedCaps);
        $this->assertSame(50, $loggedCaps[0]['cap'] ?? null);
        $encoded = json_encode($loggedCaps[0]);
        $this->assertIsString($encoded);
        $this->assertStringNotContainsString('BEGIN:VCALENDAR', $encoded);
        $this->assertStringNotContainsString('@elsewhere.test', $encoded);
    }

    public function test_event_cap_holds_across_a_second_request_for_the_same_uid(): void
    {
        $created = $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Wide Sync',
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T10:30:00Z',
                'participants' => $this->externalParticipants(50),
            ]]],
            'c0',
        ]])->assertOk();
        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);
        Mail::assertSent(OutboundMessageMail::class, 50);

        $this->forgetSchedulingProcess();

        $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'update' => [$eventId => [
                'participants' => [
                    'ext51' => [
                        '@type' => 'Participant',
                        'email' => 'guest51@elsewhere.test',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]],
            'c0',
        ]])->assertOk();

        Mail::assertSent(OutboundMessageMail::class, 50);
        $this->assertSame(
            0,
            CalendarRsvpToken::query()->where('attendee_email', 'guest51@elsewhere.test')->count(),
        );

        $this->forgetSchedulingProcess();
        $this->bobInvitesExternal();
        Mail::assertSent(OutboundMessageMail::class, 51);
    }

    public function test_cancel_and_reply_still_send_when_invites_are_off_or_hourly_capped(): void
    {
        $eventId = $this->bobInvitesExternal();
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        $this->setAppSetting(SettingKeys::IMIP_HOURLY_LIMIT, 1);

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'CANCEL';
        });

        $this->app->make(RateLimiter::class)->hit('imip:user:carol', 3600);
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:ext-org-capped\r\nSUMMARY:External Organizer\r\n"
            ."DTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nSEQUENCE:2\r\n"
            ."ORGANIZER;CN=Guest Org:mailto:org@elsewhere.test\r\n"
            ."ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('carol', 'ext-org-capped.ics', $ics);

        $this->jmapAs('carol', [
            ['CalendarEvent/set', ['accountId' => 'carol', 'update' => ['ext-org-capped' => [
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
            return $mail->outbound->calendarMethod === 'REPLY';
        });
    }

    public function test_daily_cap_does_not_block_cancel_or_reply_or_consume_the_counter(): void
    {
        $limiter = $this->app->make(RateLimiter::class);
        for ($i = 0; $i < 300; $i++) {
            $limiter->hit('imip:user-day:bob', 86400);
        }
        $dailyBefore = $limiter->attempts('imip:user-day:bob');

        $cancel = $this->externalRequest('guest@elsewhere.test', 'day-cancel');
        $cancel->method = 'CANCEL';
        $reply = $this->externalRequest('org@elsewhere.test', 'day-reply');
        $reply->method = 'REPLY';
        $imip = $this->app->make(CalendarImipService::class);
        $imip->deliver('bob', $cancel);
        $imip->deliver('bob', $reply);

        Mail::assertSent(OutboundMessageMail::class, 2);
        $this->assertSame($dailyBefore, $limiter->attempts('imip:user-day:bob'));
        $this->assertSame(0, $limiter->attempts('imip:user:bob'));
    }

    public function test_daily_limit_setting_blocks_the_next_invite(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_DAILY_LIMIT, 1);
        $imip = $this->app->make(CalendarImipService::class);

        $imip->deliver('bob', $this->externalRequest('one@elsewhere.test', 'day-limit-1'));
        $imip->deliver('bob', $this->externalRequest('two@elsewhere.test', 'day-limit-2'));

        Mail::assertSent(OutboundMessageMail::class, 1);
        $this->assertSame(1, CalendarRsvpToken::query()->count());
    }

    public function test_reschedule_reaches_a_previously_invited_guest_when_invites_are_off(): void
    {
        $eventId = $this->bobInvitesExternal();
        Mail::assertSent(OutboundMessageMail::class, 1);
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        $this->forgetSchedulingProcess();

        $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-02-01T12:00:00Z',
                'end' => '2030-02-01T12:30:00Z',
            ]]],
            'c0',
        ]])->assertOk();

        $this->assertSame(2, $this->sentTo('guest@elsewhere.test'));
        Mail::assertSent(OutboundMessageMail::class, 2);
    }

    public function test_reschedule_does_not_reach_a_guest_who_fell_outside_the_cap(): void
    {
        $created = $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Wide Sync',
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T10:30:00Z',
                'participants' => $this->externalParticipants(51),
            ]]],
            'c0',
        ]])->assertOk();
        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);
        $this->assertSame(1, $this->sentTo('guest1@elsewhere.test'));
        $this->assertSame(0, $this->sentTo('guest51@elsewhere.test'));
        $this->assertSame(
            0,
            CalendarRsvpToken::query()->where('attendee_email', 'guest51@elsewhere.test')->count(),
        );

        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        $this->forgetSchedulingProcess();

        $this->jmapAs('bob', [[
            'CalendarEvent/set',
            ['accountId' => 'bob', 'update' => [$eventId => [
                'start' => '2030-03-01T12:00:00Z',
                'end' => '2030-03-01T12:30:00Z',
            ]]],
            'c0',
        ]])->assertOk();

        $this->assertSame(2, $this->sentTo('guest1@elsewhere.test'));
        $this->assertSame(0, $this->sentTo('guest51@elsewhere.test'));
        $this->assertSame(
            0,
            CalendarRsvpToken::query()->where('attendee_email', 'guest51@elsewhere.test')->count(),
        );
    }

    public function test_previously_invited_guest_past_the_cap_still_receives_an_update_when_invites_are_off(): void
    {
        $this->setAppSetting(SettingKeys::IMIP_EXTERNAL_ENABLED, false);
        CalendarRsvpToken::query()->create([
            'token_hash' => CalendarRsvpToken::hashRaw('already-sent'),
            'event_uid' => 'wide-update',
            'attendee_email' => 'guest51@elsewhere.test',
            'organizer_username' => 'bob',
            'expires_at' => time() - 10,
            'used_partstat' => null,
        ]);

        $this->app->make(CalendarImipService::class)->deliver(
            'bob',
            $this->wideExternalRequest('wide-update', 'guest51@elsewhere.test'),
        );

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->to === ['guest51@elsewhere.test']
                && $mail->outbound->calendarMethod === 'REQUEST';
        });
    }

    public function test_event_cap_resolves_local_principals_once_per_attendee_list(): void
    {
        $connection = DB::connection('wgw');
        $connection->flushQueryLog();
        $connection->enableQueryLog();

        $imip = $this->app->make(CalendarImipService::class);
        $imip->deliver('bob', $this->wideExternalRequest('wide-memo', 'guest1@elsewhere.test'));
        $imip->deliver('bob', $this->wideExternalRequest('wide-memo', 'guest2@elsewhere.test'));

        $principalQueries = 0;
        foreach ($connection->getQueryLog() as $query) {
            if (str_contains(strtolower((string) ($query['query'] ?? '')), 'principals')) {
                $principalQueries++;
            }
        }
        $connection->disableQueryLog();

        $this->assertSame(1, $principalQueries);
        Mail::assertSent(OutboundMessageMail::class, 2);
    }

    public function test_sequence_above_zero_does_not_admit_a_guest_who_was_never_invited(): void
    {
        $message = $this->wideExternalRequest('wide-update', 'guest51@elsewhere.test');
        $message->sequence = 4;
        $this->app->make(CalendarImipService::class)->deliver('bob', $message);

        Mail::assertNothingSent();
        $this->assertSame(
            0,
            CalendarRsvpToken::query()->where('attendee_email', 'guest51@elsewhere.test')->count(),
        );
    }

    public function test_unreadable_recipient_does_not_bypass_the_event_cap(): void
    {
        $logged = [];
        Log::listen(function (MessageLogged $event) use (&$logged): void {
            if ($event->message === 'imip.attendee_cap') {
                $logged[] = $event->context;
            }
        });

        $message = new Message;
        $message->uid = '';
        $message->method = 'REQUEST';
        $message->recipient = 'not-an-email';
        $message->sender = 'mailto:bob@example.test';
        $message->message = Reader::read(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:blank\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        $this->app->make(CalendarImipService::class)->deliver('bob', $message);

        Mail::assertNothingSent();
        $this->assertSame(0, CalendarRsvpToken::query()->count());
        $this->assertNotSame([], $logged);
        $encoded = json_encode($logged[0]);
        $this->assertIsString($encoded);
        $this->assertStringNotContainsString('not-an-email', $encoded);
        $this->assertStringNotContainsString('BEGIN:VCALENDAR', $encoded);
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

    private function externalRequest(string $email, string $uid): Message
    {
        $message = new Message;
        $message->uid = $uid;
        $message->method = 'REQUEST';
        $message->recipient = 'mailto:'.$email;
        $message->sender = 'mailto:bob@example.test';
        $message->message = Reader::read(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:External Sync\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nORGANIZER:mailto:bob@example.test\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:{$email}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        return $message;
    }

    private function wideExternalRequest(string $uid, string $recipient): Message
    {
        $attendees = '';
        for ($i = 1; $i <= 51; $i++) {
            $attendees .= "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:guest{$i}@elsewhere.test\r\n";
        }
        $message = new Message;
        $message->uid = $uid;
        $message->method = 'REQUEST';
        $message->sequence = 2;
        $message->recipient = 'mailto:'.$recipient;
        $message->sender = 'mailto:bob@example.test';
        $message->message = Reader::read(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Wide\r\nDTSTART:20300301T120000Z\r\nDTEND:20300301T123000Z\r\nSEQUENCE:2\r\nORGANIZER:mailto:bob@example.test\r\n{$attendees}END:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        return $message;
    }

    private function sentTo(string $email): int
    {
        return Mail::sent(OutboundMessageMail::class, function (OutboundMessageMail $mail) use ($email): bool {
            return in_array($email, $mail->outbound->to, true);
        })->count();
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function externalParticipants(int $externalCount): array
    {
        $participants = [
            'org' => [
                '@type' => 'Participant',
                'email' => 'bob@example.test',
                'roles' => ['owner'],
            ],
        ];
        for ($i = 1; $i <= $externalCount; $i++) {
            $participants['ext'.$i] = [
                '@type' => 'Participant',
                'email' => 'guest'.$i.'@elsewhere.test',
                'roles' => ['attendee'],
                'expectReply' => true,
                'participationStatus' => 'needs-action',
            ];
        }

        return $participants;
    }

    /**
     * JMAP handlers are process singletons. Dropping them matches a new PHP-FPM
     * request, which does not keep an in-memory recipient set.
     */
    private function forgetSchedulingProcess(): void
    {
        $this->app->forgetInstance(JmapMethodDispatcher::class);
        $this->app->forgetInstance(JmapCapabilitySet::class);
        $this->app->forgetInstance(CalendarSchedulingService::class);
        $this->app->forgetInstance(CalendarImipService::class);
        $this->app->forgetInstance(CalendarEventRepository::class);
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
