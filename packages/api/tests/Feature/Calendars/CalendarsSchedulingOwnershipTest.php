<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarSchedulingDeliveryPolicy;
use App\Services\Jmap\JmapCapabilities;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Scheduling only changes the scheduling object it belongs to: an invite or
 * cancel only touches the attendee's own copy from the same organizer, a
 * reply only the organizer's own event, and an RSVP only the attendee's copy.
 */
final class CalendarsSchedulingOwnershipTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const START = '2030-03-04T10:00:00Z';

    private const END = '2030-03-04T11:00:00Z';

    /** @var list<array<string, mixed>> */
    private array $skippedDeliveries = [];

    private ?string $sabreDataDir = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedDefaultCalendarFor('dave');
        Mail::fake();
        Log::listen(function (MessageLogged $event): void {
            if ($event->message === CalendarSchedulingDeliveryPolicy::SKIPPED_LOG) {
                $this->skippedDeliveries[] = array_intersect_key($event->context, array_flip(['uid', 'recipient', 'method']));
            }
        });
    }

    protected function tearDown(): void
    {
        if ($this->sabreDataDir !== null) {
            File::deleteDirectory($this->sabreDataDir);
            $this->sabreDataDir = null;
        }
        parent::tearDown();
    }

    public function test_invite_with_an_existing_uid_leaves_the_attendees_own_event_unchanged(): void
    {
        $carolEventId = $this->createEvent('carol', 'default', 'Board meeting');
        $uid = $this->uidOf('carol', $carolEventId);

        $this->createEvent('bob', 'default', 'Other plans', ['carol'], $uid);

        $this->assertSame('Board meeting', $this->titleOf('carol', $carolEventId));
        $this->assertSame([], $this->inboxRows('carol'));
        $this->assertCount(1, $this->ownedObjects('carol', $uid));
        $this->assertSame([['uid' => $uid, 'recipient' => 'principals/carol', 'method' => 'REQUEST']], $this->skippedDeliveries);
    }

    public function test_cancel_with_an_existing_uid_leaves_the_attendees_own_event_in_place(): void
    {
        $carolEventId = $this->createEvent('carol', 'default', 'Board meeting');
        $uid = $this->uidOf('carol', $carolEventId);
        $bobEventId = $this->createEvent('bob', 'default', 'Other plans', ['carol'], $uid);

        $this->jmapAs('bob', [['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$bobEventId]], 'c0']])->assertOk();

        $this->assertSame('Board meeting', $this->titleOf('carol', $carolEventId));
    }

    public function test_invite_does_not_replace_an_invite_copy_from_another_organizer(): void
    {
        $bobEventId = $this->createEvent('bob', 'default', 'Planning', ['carol']);
        $uid = $this->uidOf('bob', $bobEventId);

        $this->createEvent('dave', 'default', 'Something else', ['carol'], $uid);

        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies);
        $this->assertStringContainsString('SUMMARY:Planning', $this->ics($copies[0]));
        $this->assertStringContainsString('mailto:bob@example.test', $this->ics($copies[0]));
        $this->assertCount(1, $this->inboxRows('carol'));
        $this->assertStringContainsString('SUMMARY:Planning', $this->inboxRows('carol')[0]);
    }

    public function test_invite_does_not_reach_an_event_in_a_calendar_shared_to_the_attendee(): void
    {
        $this->createCalendar('dave', 'dave-plans', ['carol' => ['mayReadItems' => true]]);
        $daveEventId = $this->createEvent('dave', 'dave-plans', 'Dave only');
        $uid = $this->uidOf('dave', $daveEventId);

        $this->createEvent('bob', 'default', 'Bob invite', ['carol'], $uid);

        $this->assertSame('Dave only', $this->titleOf('dave', $daveEventId));
        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies, 'the attendee gets a separate copy in a calendar she owns');
        $this->assertStringContainsString('SUMMARY:Bob invite', $this->ics($copies[0]));
        $this->assertSame([], $this->skippedDeliveries);
    }

    public function test_organizer_update_and_cancel_still_reach_the_attendee_copy(): void
    {
        $bobEventId = $this->createEvent('bob', 'default', 'Planning', ['carol']);
        $uid = $this->uidOf('bob', $bobEventId);
        $this->assertCount(1, $this->ownedObjects('carol', $uid));

        $this->jmapAs('bob', [['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$bobEventId => [
            'title' => 'Planning (moved)',
            'start' => '2030-03-04T12:00:00Z',
            'end' => '2030-03-04T13:00:00Z',
        ]]], 'c0']])->assertOk();

        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies);
        $this->assertStringContainsString('SUMMARY:Planning (moved)', $this->ics($copies[0]));

        $this->jmapAs('bob', [['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$bobEventId]], 'c0']])->assertOk();

        $this->assertSame([], $this->ownedObjects('carol', $uid));
        $this->assertSame([], $this->skippedDeliveries);
    }

    public function test_reply_from_someone_who_is_not_invited_leaves_the_organizer_event_unchanged(): void
    {
        $bobEventId = $this->createEvent('bob', 'default', 'Planning', ['carol']);
        $uid = $this->uidOf('bob', $bobEventId);

        $this->jmapAs('dave', [['CalendarEvent/set', ['accountId' => 'dave', 'create' => ['r' => [
            'calendarIds' => ['default' => true],
            'uid' => $uid,
            'title' => 'Planning',
            'start' => self::START,
            'end' => self::END,
            'participants' => [
                'org' => ['@type' => 'Participant', 'email' => 'bob@example.test', 'roles' => ['owner']],
                'me' => ['@type' => 'Participant', 'email' => 'dave@example.test', 'roles' => ['attendee'], 'participationStatus' => 'accepted'],
            ],
        ]]], 'c0']])->assertOk();

        $this->assertNotContains('dave@example.test', array_keys($this->partstats('bob', $bobEventId)));
    }

    public function test_attendee_with_a_read_only_share_answers_their_own_copy(): void
    {
        $this->createCalendar('bob', 'bob-plans', ['carol' => ['mayReadItems' => true]]);
        $bobEventId = $this->createEvent('bob', 'bob-plans', 'Planning', ['carol']);

        $notification = $this->onlyNotification('carol');
        $this->assertNotSame($bobEventId, $notification['eventId']);

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notification['id'].'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->assertSame([$bobEventId], $this->eventIdsIn('bob', 'bob-plans'));
        $this->assertSame('accepted', $this->partstats('bob', $bobEventId)['carol@example.test'] ?? null);
    }

    public function test_rsvp_with_a_calendar_choice_never_moves_the_organizer_event(): void
    {
        $this->createCalendar('bob', 'bob-plans', ['carol' => ['mayWriteAll' => true]]);
        $bobEventId = $this->createEvent('bob', 'bob-plans', 'Planning', ['carol']);
        $this->seedNamedCalendarFor('carol', 'work', 'Work');

        $notification = $this->onlyNotification('carol');
        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notification['id'].'/respond',
            ['participationStatus' => 'accepted', 'calendarId' => 'work'],
        )->assertOk();

        $this->assertSame([$bobEventId], $this->eventIdsIn('bob', 'bob-plans'));
        $this->assertSame([$notification['eventId']], $this->eventIdsIn('carol', 'work'));
    }

    public function test_rsvp_skips_the_organizer_event_in_a_shared_group_calendar(): void
    {
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        foreach (['bob', 'carol'] as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
        $groupCalendarId = CalendarCollectionUris::groupCalendarApiId('team');
        $this->jmapAs('bob', [['Calendar/get', ['accountId' => 'bob', 'ids' => [$groupCalendarId]], 'c0']])->assertOk();
        $bobEventId = $this->createEvent('bob', $groupCalendarId, 'Team planning', ['carol']);
        $uid = $this->uidOf('bob', $bobEventId);
        // The attendee no longer has a personal copy; the group calendar still holds the organizer's event.
        foreach ($this->ownedObjects('carol', $uid) as $copy) {
            $copy->delete();
        }
        $this->seedNamedCalendarFor('carol', 'work', 'Work');

        $notification = $this->onlyNotification('carol');
        $this->assertNotSame($bobEventId, $notification['eventId']);
        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notification['id'].'/respond',
            ['participationStatus' => 'accepted', 'calendarId' => 'work'],
        )->assertOk();

        $this->assertSame([$bobEventId], $this->eventIdsIn('bob', $groupCalendarId));
    }

    public function test_guest_rsvp_updates_the_organizers_own_event(): void
    {
        $this->enableMailSubmit();
        $this->createCalendar('carol', 'carol-shared', ['bob' => ['mayWriteAll' => true]]);
        $uid = 'urn:uuid:'.uniqid('rsvp-', true);
        $carolEventId = $this->createEvent('carol', 'carol-shared', 'Carol only', [], $uid);
        $bobEventId = $this->createEvent('bob', 'default', 'Guest sync', ['guest@elsewhere.test'], $uid);

        $this->postJson('/api/v1/calendar/rsvp/'.$this->rawRsvpToken(), ['participationStatus' => 'accepted'])
            ->assertOk()
            ->assertJsonPath('title', 'Guest sync');

        $this->assertSame('accepted', $this->partstats('bob', $bobEventId)['guest@elsewhere.test'] ?? null);
        $this->assertSame('Carol only', $this->titleOf('carol', $carolEventId));
    }

    public function test_guest_rsvp_works_for_an_invite_from_a_group_calendar(): void
    {
        $this->enableMailSubmit();
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
        $groupCalendarId = CalendarCollectionUris::groupCalendarApiId('team');
        $this->jmapAs('bob', [['Calendar/get', ['accountId' => 'bob', 'ids' => [$groupCalendarId]], 'c0']])->assertOk();
        $bobEventId = $this->createEvent('bob', $groupCalendarId, 'Team sync', ['guest@elsewhere.test']);

        $raw = $this->rawRsvpToken();
        $this->getJson('/api/v1/calendar/rsvp/'.$raw)->assertOk()->assertJsonPath('title', 'Team sync');
        $this->postJson('/api/v1/calendar/rsvp/'.$raw, ['participationStatus' => 'accepted'])->assertOk();

        $this->assertSame('accepted', $this->partstats('bob', $bobEventId)['guest@elsewhere.test'] ?? null);
    }

    public function test_reply_lands_on_an_invite_organized_in_a_calendar_shared_with_write_access(): void
    {
        $this->createCalendar('carol', 'carol-team', ['bob' => ['mayWriteAll' => true]]);
        $bobEventId = $this->createEvent('bob', $this->sharedCalendarId('bob', 'carol', 'carol-team'), 'Shared planning', ['dave']);

        $notification = $this->onlyNotification('dave');
        $this->asUser('dave')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notification['id'].'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk();

        $this->assertSame('accepted', $this->partstats('bob', $bobEventId)['dave@example.test'] ?? null);
        $this->assertSame([$bobEventId], $this->eventIdsIn('carol', 'carol-team'));
    }

    public function test_guest_rsvp_lands_on_an_invite_organized_in_a_calendar_shared_with_write_access(): void
    {
        $this->enableMailSubmit();
        $this->createCalendar('carol', 'carol-team', ['bob' => ['mayWriteAll' => true]]);
        $bobEventId = $this->createEvent('bob', $this->sharedCalendarId('bob', 'carol', 'carol-team'), 'Shared sync', ['guest@elsewhere.test']);

        $this->postJson('/api/v1/calendar/rsvp/'.$this->rawRsvpToken(), ['participationStatus' => 'accepted'])
            ->assertOk()
            ->assertJsonPath('title', 'Shared sync');

        $this->assertSame('accepted', $this->partstats('bob', $bobEventId)['guest@elsewhere.test'] ?? null);
    }

    public function test_reply_and_guest_rsvp_never_touch_a_read_only_shared_calendar(): void
    {
        $this->enableMailSubmit();
        $this->createCalendar('carol', 'carol-view', ['bob' => ['mayReadItems' => true]]);
        $uid = 'urn:uuid:'.uniqid('ro-', true);
        $carolEventId = $this->createEvent('carol', 'carol-view', 'Read-only copy', ['dave', 'guest@elsewhere.test'], $uid, 'bob');
        $before = $this->partstats('carol', $carolEventId);

        // The organizer's own event is gone; only the read-only shared object keeps the UID.
        $bobEventId = $this->createEvent('bob', 'default', 'Bob sync', ['guest@elsewhere.test'], $uid);
        $raw = $this->rawRsvpToken();
        foreach ($this->ownedObjects('bob', $uid) as $object) {
            $object->delete();
        }
        $this->assertNotSame('', $bobEventId);

        $this->postJson('/api/v1/calendar/rsvp/'.$raw, ['participationStatus' => 'accepted'])->assertNotFound();
        $this->jmapAs('dave', [['CalendarEvent/set', ['accountId' => 'dave', 'create' => ['r' => [
            'calendarIds' => ['default' => true],
            'uid' => $uid,
            'title' => 'Read-only copy',
            'start' => self::START,
            'end' => self::END,
            'participants' => [
                'org' => ['@type' => 'Participant', 'email' => 'bob@example.test', 'roles' => ['owner']],
                'me' => ['@type' => 'Participant', 'email' => 'dave@example.test', 'roles' => ['attendee'], 'participationStatus' => 'accepted'],
            ],
        ]]], 'c0']])->assertOk();

        $this->assertSame($before, $this->partstats('carol', $carolEventId));
        $this->assertSame('Read-only copy', $this->titleOf('carol', $carolEventId));
    }

    public function test_caldav_invite_with_an_existing_uid_leaves_the_attendees_own_event_unchanged(): void
    {
        $carolEventId = $this->createEvent('carol', 'default', 'Board meeting');
        $uid = $this->uidOf('carol', $carolEventId);

        $status = $this->sabrePut('bob', '/calendars/bob/default/collision.ics', $this->inviteIcs($uid, 'Other plans'));

        $this->assertContains($status, [201, 204]);
        $this->assertSame('Board meeting', $this->titleOf('carol', $carolEventId));
        $this->assertSame([], $this->inboxRows('carol'));
        $this->assertSame([['uid' => $uid, 'recipient' => 'principals/carol', 'method' => 'REQUEST']], $this->skippedDeliveries);
    }

    public function test_caldav_organizer_update_still_reaches_the_attendee_copy(): void
    {
        $uid = 'caldav-owned-'.uniqid();
        $this->assertContains($this->sabrePut('bob', '/calendars/bob/default/plan.ics', $this->inviteIcs($uid, 'Plan')), [201, 204]);
        $this->assertCount(1, $this->ownedObjects('carol', $uid));

        $this->assertContains($this->sabrePut('bob', '/calendars/bob/default/plan.ics', $this->inviteIcs($uid, 'Plan v2', 1)), [201, 204]);

        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies);
        $this->assertStringContainsString('SUMMARY:Plan v2', $this->ics($copies[0]));
        $this->assertSame([], $this->skippedDeliveries);
    }

    /**
     * @return array<string, array{0: array<string, bool>}>
     */
    public static function shareRights(): array
    {
        return [
            'read-only share' => [['mayReadItems' => true]],
            'write share' => [['mayWriteAll' => true]],
        ];
    }

    /**
     * @param  array<string, bool>  $rights
     */
    #[DataProvider('shareRights')]
    public function test_caldav_invite_does_not_reach_an_event_in_a_calendar_shared_to_the_attendee(array $rights): void
    {
        $this->createCalendar('dave', 'dave-plans', ['carol' => $rights]);
        $daveEventId = $this->createEvent('dave', 'dave-plans', 'Dave only');
        $uid = $this->uidOf('dave', $daveEventId);
        $before = $this->calendarData('dave', 'dave-plans', $uid);

        $status = $this->sabrePut('bob', '/calendars/bob/default/shared-uid.ics', $this->inviteIcs($uid, 'Bob invite'));

        $this->assertContains($status, [201, 204]);
        $this->assertSame($before, $this->calendarData('dave', 'dave-plans', $uid));
        $this->assertSame('Dave only', $this->titleOf('dave', $daveEventId));
        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies, 'the attendee gets a separate copy in a calendar she owns');
        $this->assertStringContainsString('SUMMARY:Bob invite', $this->ics($copies[0]));
        $this->assertSame([], $this->skippedDeliveries);
    }

    public function test_caldav_new_invite_copy_lands_in_a_calendar_the_attendee_owns(): void
    {
        $this->createCalendar('dave', 'dave-plans', ['carol' => ['mayWriteAll' => true]]);
        // List the shared calendar first in the attendee's calendar home.
        foreach (CalendarInstance::query()->where('principaluri', 'principals/carol')->get() as $instance) {
            $instance->update(['calendarorder' => (int) $instance->access === SharingPlugin::ACCESS_SHAREDOWNER ? 2 : 1]);
        }
        $first = app(WgwCalendarBackendFactory::class)->make()->getCalendarsForUser('principals/carol')[0] ?? [];
        $this->assertNotSame(SharingPlugin::ACCESS_SHAREDOWNER, (int) ($first['share-access'] ?? 0));
        $uid = 'caldav-new-'.uniqid();

        $this->assertContains($this->sabrePut('bob', '/calendars/bob/default/new.ics', $this->inviteIcs($uid, 'Fresh invite')), [201, 204]);

        $this->assertNull($this->calendarData('dave', 'dave-plans', $uid));
        $copies = $this->ownedObjects('carol', $uid);
        $this->assertCount(1, $copies);
        $this->assertStringContainsString('SUMMARY:Fresh invite', $this->ics($copies[0]));
    }

    // ---- helpers ------------------------------------------------------------

    /**
     * @param  list<string>  $attendees  usernames or external email addresses
     */
    private function createEvent(
        string $username,
        string $calendarId,
        string $title,
        array $attendees = [],
        ?string $uid = null,
        ?string $organizer = null,
    ): string {
        $payload = ['calendarIds' => [$calendarId => true], 'title' => $title, 'start' => self::START, 'end' => self::END];
        if ($uid !== null) {
            $payload['uid'] = $uid;
        }
        if ($attendees !== []) {
            $payload['participants'] = ['org' => ['@type' => 'Participant', 'email' => ($organizer ?? $username).'@example.test', 'roles' => ['owner']]];
            foreach ($attendees as $index => $attendee) {
                $payload['participants']['a'.$index] = [
                    '@type' => 'Participant',
                    'email' => str_contains($attendee, '@') ? $attendee : $attendee.'@example.test',
                    'roles' => ['attendee'],
                    'expectReply' => true,
                    'participationStatus' => 'needs-action',
                ];
            }
        }
        $id = (string) $this->jmapAs($username, [['CalendarEvent/set', ['accountId' => $username, 'create' => ['e' => $payload]], 'c0']])
            ->assertOk()
            ->json('methodResponses.0.1.created.e.id');
        $this->assertNotSame('', $id);

        return $id;
    }

    /**
     * @param  array<string, array<string, bool>>  $shareWith
     */
    private function createCalendar(string $username, string $id, array $shareWith): void
    {
        $this->jmapAs($username, [['Calendar/set', ['accountId' => $username, 'create' => ['c' => [
            'id' => $id,
            'name' => $id,
            'shareWith' => $shareWith,
        ]]], 'c0']])->assertOk()->assertJsonPath('methodResponses.0.1.created.c.id', $id);
    }

    /**
     * The sharee's calendar id for a calendar another user shared with them.
     */
    private function sharedCalendarId(string $sharee, string $owner, string $ownerCalendarUri): string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$owner)
            ->where('uri', $ownerCalendarUri)
            ->value('calendarid');
        $uri = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$sharee)
            ->where('calendarid', (int) $calendarId)
            ->value('uri');
        $this->assertIsString($uri);

        return $uri;
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
        return $this->withBearer($username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username));
    }

    /**
     * @return array<string, mixed>
     */
    private function event(string $username, string $eventId): array
    {
        $event = $this->jmapAs($username, [['CalendarEvent/get', ['accountId' => $username, 'ids' => [$eventId]], 'c0']])
            ->assertOk()
            ->json('methodResponses.0.1.list.0');
        $this->assertIsArray($event);

        return $event;
    }

    private function uidOf(string $username, string $eventId): string
    {
        return (string) $this->event($username, $eventId)['uid'];
    }

    private function titleOf(string $username, string $eventId): string
    {
        return (string) $this->event($username, $eventId)['title'];
    }

    /**
     * @return array<string, string> participant email => participation status
     */
    private function partstats(string $username, string $eventId): array
    {
        $statuses = [];
        foreach ($this->event($username, $eventId)['participants'] ?? [] as $participant) {
            if (is_array($participant) && is_string($participant['email'] ?? null)) {
                $statuses[$participant['email']] = strtolower((string) ($participant['participationStatus'] ?? 'needs-action'));
            }
        }

        return $statuses;
    }

    /**
     * @return list<string>
     */
    private function eventIdsIn(string $username, string $calendarId): array
    {
        $ids = $this->jmapAs($username, [['CalendarEvent/query', ['accountId' => $username, 'filter' => ['inCalendars' => [$calendarId]]], 'q0']])
            ->assertOk()
            ->json('methodResponses.0.1.ids');

        return array_values(array_map('strval', (array) $ids));
    }

    /**
     * @return array{id: string, eventId: string}
     */
    private function onlyNotification(string $username): array
    {
        $list = $this->asUser($username)->getJson('/api/v1/calendars/scheduling/notifications')->assertOk()->json('list');
        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertIsString($list[0]['eventId'] ?? null);

        return ['id' => (string) $list[0]['id'], 'eventId' => (string) $list[0]['eventId']];
    }

    /**
     * Objects with the UID in calendars the user owns.
     *
     * @return list<CalendarObject>
     */
    private function ownedObjects(string $username, string $uid): array
    {
        return array_values(CalendarObject::query()
            ->where('uid', $uid)
            ->whereHas('calendar.instances', function ($query) use ($username): void {
                $query->where('principaluri', 'principals/'.$username)->where('access', SharingPlugin::ACCESS_SHAREDOWNER);
            })
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * Raw data of the object with the UID in one of the owner's calendars.
     */
    private function calendarData(string $owner, string $calendarUri, string $uid): ?string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$owner)
            ->where('uri', $calendarUri)
            ->value('calendarid');
        $this->assertNotNull($calendarId);
        $data = CalendarObject::query()
            ->where('calendarid', (int) $calendarId)
            ->where('uid', $uid)
            ->value('calendardata');

        return $data === null ? null : (string) $data;
    }

    private function ics(CalendarObject $object): string
    {
        return str_replace(["\r\n ", "\n "], '', (string) $object->calendardata);
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

    private function inviteIcs(string $uid, string $summary, int $sequence = 0): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\nSEQUENCE:{$sequence}\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:20300304T100000Z\r\nDTEND:20300304T110000Z\r\n"
            ."ORGANIZER;CN=Bob:mailto:bob@example.test\r\n"
            ."ATTENDEE;CN=Carol;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * PUT through Sabre as $username. Sabre keeps its lock file in the data
     * dir, so the test points it at one temporary dir (removed in tearDown).
     */
    private function sabrePut(string $username, string $path, string $body): int
    {
        if ($this->sabreDataDir === null) {
            $this->sabreDataDir = sys_get_temp_dir().'/wgw-sabre-sched-'.uniqid('', true);
            mkdir($this->sabreDataDir, 0775, true);
            config(['wgw.data_dir' => $this->sabreDataDir]);
        }
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest('PUT', $path, ['Authorization' => $auth, 'Content-Type' => 'text/calendar'], $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return $e->getHTTPCode();
        }
        $status = $response->getStatus();

        return is_int($status) ? $status : 500;
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

    private function rawRsvpToken(): string
    {
        $mail = Mail::sent(OutboundMessageMail::class, static fn (OutboundMessageMail $mail): bool => $mail->outbound->calendarMethod === 'REQUEST')->last();
        $this->assertInstanceOf(OutboundMessageMail::class, $mail);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $mail->outbound->textBody, $match));

        return $match[1];
    }
}
