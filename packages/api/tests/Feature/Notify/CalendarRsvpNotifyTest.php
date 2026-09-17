<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\CalendarObject;
use App\Models\CalendarRsvpToken;
use App\Models\Notification;
use App\Services\Jmap\JmapCapabilities;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Notify\CalendarRsvpNotify;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Suite inbox fan-out for local iTIP REPLY → organizer (Task #796).
 */
final class CalendarRsvpNotifyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
        Cache::flush();
    }

    public function test_organizer_gets_rsvp_tray_and_invitee_does_not(): void
    {
        $this->carolAcceptsInvite();

        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'carol')->where('action', 'rsvp')->count());

        $row = Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->first();
        $this->assertNotNull($row);
        $this->assertSame('Carol accepted Standup', $row->title);
        $this->assertSame(CalendarRsvpNotify::NAVIGATE, $row->navigate);
        $this->assertStringStartsWith('calendar.rsvp:', (string) $row->tag);
        $this->assertIsArray($row->data);
        $this->assertSame('Carol', $row->data['actor'] ?? null);
        $this->assertSame('Standup', $row->data['summary'] ?? null);
        $this->assertSame('accepted', $row->data['participationStatus'] ?? null);
    }

    public function test_partstat_change_supersedes_prior_rsvp_row(): void
    {
        $eventId = $this->carolAcceptsInvite();
        $before = Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->first();
        $this->assertNotNull($before);
        $beforeId = $before->id;

        $this->carolSetsPartstat($eventId, 'declined');

        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->count());
        $after = Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->first();
        $this->assertNotNull($after);
        $this->assertSame($beforeId, $after->id);
        $this->assertSame('Carol declined Standup', $after->title);
        $this->assertSame('declined', $after->data['participationStatus'] ?? null);
        $this->assertNull($after->read_at);
    }

    public function test_cancel_does_not_create_rsvp_row(): void
    {
        $eventId = $this->bobInvitesCarol();
        Notification::query()->delete();

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        $this->assertSame(0, Notification::query()->where('action', 'rsvp')->count());
    }

    public function test_guest_imip_token_respond_does_not_self_notify_organizer(): void
    {
        $this->enableMailSubmit();
        $this->bobInvitesExternal();
        $raw = $this->rawRsvpTokenFromLatestRequest();
        Notification::query()->delete();

        $this->postJson('/api/v1/calendar/rsvp/'.$raw, [
            'participationStatus' => 'accepted',
        ])->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('action', 'rsvp')->count());
        $this->assertSame(0, Notification::query()->where('action', 'rsvp')->count());
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

    private function carolAcceptsInvite(): string
    {
        $eventId = $this->bobInvitesCarol();
        $this->carolSetsPartstat($eventId, 'accepted');

        return $eventId;
    }

    private function carolSetsPartstat(string $bobEventId, string $status): void
    {
        $uid = $this->eventUid($bobEventId);
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
                        'participationStatus' => $status,
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();
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

    private function eventUid(string $eventId): string
    {
        $event = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $uid = (string) ($event['uid'] ?? '');
        $this->assertNotSame('', $uid);

        return $uid;
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

    private function rawRsvpTokenFromLatestRequest(): string
    {
        $sent = Mail::sent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REQUEST';
        });
        $this->assertFalse($sent->isEmpty(), 'expected a REQUEST iMIP message');
        $mail = $sent->last();
        $this->assertInstanceOf(OutboundMessageMail::class, $mail);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $mail->outbound->textBody, $match));
        $this->assertNotNull(CalendarRsvpToken::query()->first());

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
