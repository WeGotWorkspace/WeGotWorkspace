<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\CalendarFeedToken;
use App\Services\Calendars\HostIpResolver;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Ownership matrix for calendars (plan chunk-b-calendars): JMAP Calendar/*
 * and CalendarEvent/*, ICS import, feed publishing, subscriptions, and the
 * scheduling inbox.
 *
 * Each case seeds one calendar holding one event, owned and shared as the
 * scope describes, through the owner's own JMAP account. Sharees address a
 * shared calendar by their own copy id; invisible scopes use the owner's id,
 * and revoked or dismissed grants reuse the copy id the actor saw before.
 * Event ids do not depend on the calendar, so every scope uses the owner's.
 *
 * Subscriptions and scheduling notifications are per-user records, so they
 * only have own-user and other-user rows. The own-group cells of feed
 * publish and revoke belong to plan chunk S.
 */
final class CalendarsOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    private const USING = [JmapCapabilities::CORE, JmapCapabilities::CALENDARS];

    private const CAL_GET = 'JMAP Calendar/get';

    private const CAL_CHANGES = 'JMAP Calendar/changes';

    private const CAL_SET = 'JMAP Calendar/set';

    private const EVT_GET = 'JMAP CalendarEvent/get';

    private const EVT_CHANGES = 'JMAP CalendarEvent/changes';

    private const EVT_SET = 'JMAP CalendarEvent/set';

    private const EVT_QUERY = 'JMAP CalendarEvent/query';

    private const EVT_QUERY_CHANGES = 'JMAP CalendarEvent/queryChanges';

    private const IMPORT = 'POST /calendars/events/import';

    private const FEED_GET = 'GET /calendars/{calendarId}/feed';

    private const FEED_POST = 'POST /calendars/{calendarId}/feed';

    private const FEED_DELETE = 'DELETE /calendars/{calendarId}/feed';

    private const SUB_INDEX = 'GET /calendars/subscriptions';

    private const SUB_STORE = 'POST /calendars/subscriptions';

    private const SUB_SHOW = 'GET /calendars/subscriptions/{id}';

    private const SUB_REFRESH = 'POST /calendars/subscriptions/{id}/refresh';

    private const SUB_DELETE = 'DELETE /calendars/subscriptions/{id}';

    private const SCHED_INVITEES = 'GET /calendars/scheduling/invitees';

    private const SCHED_INDEX = 'GET /calendars/scheduling/notifications';

    private const SCHED_RESPOND = 'POST /calendars/scheduling/notifications/{notificationId}/respond';

    private const SCHED_DELETE = 'DELETE /calendars/scheduling/notifications/{notificationId}';

    private const FEED_URL = 'https://feeds.example.test/matrix.ics';

    private const START = '2030-01-15T10:00:00Z';

    private const END = '2030-01-15T11:00:00Z';

    private const VISIBLE = [
        Scope::OwnUser, Scope::OwnGroup,
        Scope::UserToActorRead, Scope::UserToActorWrite,
        Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
        Scope::UserToActorGroup,
    ];

    private const READ_ONLY = [Scope::UserToActorRead, Scope::GroupToNonmemberRead];

    private const SHAREE = [
        Scope::UserToActorRead, Scope::UserToActorWrite,
        Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
        Scope::UserToActorGroup,
    ];

    /**
     * member runs every scope. admin runs a subset that proves it has no
     * bypass over per-object access: its own group, another user's and
     * another group's calendar, and a read-only grant. Listing methods are
     * covered for admin by the full list that every get row also checks.
     */
    private const ADMIN_SCOPES = [Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::UserToActorRead];

    /** Collection delete, admin's one extra right: every outcome type it can meet. */
    private const ADMIN_DESTROY_SCOPES = [
        Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup,
        Scope::UserToActorRead, Scope::UserToActorGroup,
    ];

    /** Listing methods: admin covers them through the get rows' full list. */
    private const LISTING_OPS = [self::CAL_CHANGES, self::EVT_CHANGES, self::EVT_QUERY];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        Mail::fake();
        Http::preventStrayRequests();
        $this->app->instance(HostIpResolver::class, (new FakeHostIpResolver)->map('feeds.example.test', ['93.184.216.34']));
        Http::fake([self::FEED_URL => Http::response($this->icsBody('feed-event@example.test', 'Feed event'), 200, ['Content-Type' => 'text/calendar'])]);
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        $scopes = array_merge([Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup], self::grantScopes());

        foreach (Actor::signedIn() as $actor) {
            $member = $actor === Actor::Member;
            foreach ($scopes as $scope) {
                $visible = in_array($scope, self::VISIBLE, true);
                $readOnly = in_array($scope, self::READ_ONLY, true);
                $sharee = in_array($scope, self::SHAREE, true);
                $read = $visible ? Outcome::Allowed : Outcome::NotFound;
                $write = ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed);
                // Sharees see the calendar but never get re-share or publish rights.
                $manage = ! $visible ? Outcome::NotFound : ($sharee ? Outcome::Forbidden : Outcome::Allowed);

                if ($member || in_array($scope, self::ADMIN_DESTROY_SCOPES, true)) {
                    $cases[] = self::calendarDestroyCase($actor, $scope, $visible, $sharee);
                }
                if (! $member && ! in_array($scope, self::ADMIN_SCOPES, true)) {
                    continue;
                }

                foreach ([self::CAL_GET, self::CAL_CHANGES, self::EVT_GET, self::EVT_CHANGES, self::EVT_QUERY] as $op) {
                    if ($member || ! in_array($op, self::LISTING_OPS, true)) {
                        $cases[] = OwnershipCase::of($op, $actor, $scope, $read);
                    }
                }
                $cases[] = OwnershipCase::of(self::CAL_SET, $actor, $scope, $read)->variant('rename');
                $cases[] = OwnershipCase::of(self::CAL_SET, $actor, $scope, $manage)->variant('reshare');
                foreach (['create', 'update', 'destroy'] as $variant) {
                    $cases[] = OwnershipCase::of(self::EVT_SET, $actor, $scope, $write)->variant($variant);
                }
                $cases[] = OwnershipCase::of(self::IMPORT, $actor, $scope, $write);
                // Reading the feed returns its public URL: publish management, not a calendar read.
                $cases[] = OwnershipCase::of(self::FEED_GET, $actor, $scope, $manage);
                if ($scope !== Scope::OwnGroup) {
                    $cases[] = OwnershipCase::of(self::FEED_POST, $actor, $scope, $manage);
                    $cases[] = OwnershipCase::of(self::FEED_DELETE, $actor, $scope, $manage);
                }
            }

            // Two-target event writes: the actor's own event into the scope's
            // calendar, and the scope's event into the actor's own calendar.
            foreach ($member ? [Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::UserToActorRead, Scope::UserToActorWrite] : [Scope::OtherUser, Scope::UserToActorRead] as $scope) {
                $outcome = match ($scope) {
                    Scope::OwnGroup, Scope::UserToActorWrite => Outcome::Allowed,
                    Scope::UserToActorRead => Outcome::Forbidden,
                    default => Outcome::NotFound,
                };
                $cases[] = OwnershipCase::of(self::EVT_SET, $actor, $scope, $outcome)->variant('move-into');
            }
            foreach ($member ? [Scope::UserToActorRead, Scope::GroupToNonmemberRead] : [Scope::UserToActorRead] as $scope) {
                $cases[] = OwnershipCase::of(self::EVT_SET, $actor, $scope, Outcome::Forbidden)->variant('move-out');
            }

            // An invite the actor sends carries the uid of an event in the scope's
            // calendar. Inviting its owner must not touch that event.
            foreach ($member ? [Scope::OtherUser, Scope::UserToActorRead] : [Scope::UserToActorRead] as $scope) {
                $cases[] = OwnershipCase::of(self::EVT_SET, $actor, $scope, Outcome::Allowed)->variant('uid-collision');
            }

            // A write grant reaches the actor twice: through the owning group and
            // through a direct read-only copy. The stronger right applies.
            $cases[] = OwnershipCase::of(self::EVT_SET, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('direct-read-copy');
            $cases[] = OwnershipCase::of(self::EVT_SET, $actor, Scope::UserToActorGroup, Outcome::Allowed)->variant('group-write-direct-read');

            // queryChanges is not supported: every scope gets cannotCalculateChanges
            // and no ids. The own-user row proves the answer does not depend on access.
            if ($member) {
                $cases[] = OwnershipCase::of(self::EVT_QUERY_CHANGES, $actor, Scope::OwnUser, Outcome::Allowed);
            }
            $cases[] = OwnershipCase::of(self::EVT_QUERY_CHANGES, $actor, Scope::OtherUser, Outcome::NotFound);

            foreach ([Scope::OwnUser, Scope::OwnGroup] as $scope) {
                $cases[] = OwnershipCase::of(self::CAL_SET, $actor, $scope, Outcome::Allowed)->variant('create');
            }
            // The membership check answers 403 for every slug the caller is not
            // in, existing or not, so it reveals nothing (see unknown-group).
            foreach ([Scope::OtherGroup, Scope::FormerGroup] as $scope) {
                $cases[] = OwnershipCase::of(self::CAL_SET, $actor, $scope, Outcome::Forbidden)->variant('create');
            }
            $cases[] = OwnershipCase::of(self::CAL_SET, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('create-unknown-group');
            // groupSlug on update moves the actor's own calendar into a group.
            $cases[] = OwnershipCase::of(self::CAL_SET, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('body-target');

            // Subscriptions and scheduling notifications belong to one user.
            foreach ([self::SUB_INDEX, self::SUB_SHOW, self::SUB_REFRESH, self::SUB_DELETE, self::SCHED_INDEX, self::SCHED_RESPOND, self::SCHED_DELETE] as $op) {
                if ($member) {
                    $cases[] = OwnershipCase::of($op, $actor, Scope::OwnUser, Outcome::Allowed);
                }
                $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::NotFound);
            }
            foreach ($member ? [Scope::OwnUser, Scope::OwnGroup] : [Scope::OwnGroup] as $scope) {
                $cases[] = OwnershipCase::of(self::SUB_STORE, $actor, $scope, Outcome::Allowed);
            }
            foreach ($member ? [Scope::OtherGroup, Scope::FormerGroup] : [Scope::OtherGroup] as $scope) {
                $cases[] = OwnershipCase::of(self::SUB_STORE, $actor, $scope, Outcome::Forbidden);
            }
            // The invitee picker is an instance directory by design: names and addresses only.
            $cases[] = OwnershipCase::of(self::SCHED_INVITEES, $actor, Scope::None, Outcome::Allowed);
        }

        // A foreign accountId is refused before any lookup.
        foreach ([self::CAL_GET, self::CAL_CHANGES, self::CAL_SET, self::EVT_GET, self::EVT_CHANGES, self::EVT_QUERY, self::EVT_SET, self::EVT_QUERY_CHANGES] as $op) {
            $cases[] = OwnershipCase::of($op, Actor::Member, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }
        $cases[] = OwnershipCase::of(self::SUB_STORE, Actor::Member, Scope::OtherGroup, Outcome::Forbidden)->variant('unknown-group');
        // calendarId in an RSVP body names the calendar that receives the copy.
        $cases[] = OwnershipCase::of(self::SCHED_RESPOND, Actor::Member, Scope::OtherUser, Outcome::NotFound)->variant('body-target');
        // The organizer's calendar is shared with the invited actor. The actor
        // answers its own invite; the organizer's event stays where it is.
        foreach ([Scope::UserToActorRead, Scope::UserToActorWrite] as $scope) {
            $cases[] = OwnershipCase::of(self::SCHED_RESPOND, Actor::Member, $scope, Outcome::Allowed)->variant('shared-organizer-copy');
        }

        foreach ([
            self::IMPORT, self::FEED_GET, self::FEED_POST, self::FEED_DELETE,
            self::SUB_INDEX, self::SUB_STORE, self::SUB_SHOW, self::SUB_REFRESH, self::SUB_DELETE,
            self::SCHED_INVITEES, self::SCHED_INDEX, self::SCHED_RESPOND, self::SCHED_DELETE,
        ] as $op) {
            $cases[] = OwnershipCase::of($op, Actor::Anonymous, Scope::OtherUser, Outcome::Unauthenticated);
        }

        return $cases;
    }

    /**
     * @return iterable<string, array{0: OwnershipCase}>
     */
    public static function casesProvider(): iterable
    {
        foreach (self::ownershipCases() as $case) {
            yield $case->key() => [$case];
        }
    }

    #[DataProvider('casesProvider')]
    public function test_ownership_case(OwnershipCase $case): void
    {
        $this->runOwnershipCase($case, fn () => $this->runCase($case));
    }

    /**
     * @return list<Scope>
     */
    private static function grantScopes(): array
    {
        return [
            Scope::UserToActorRead, Scope::UserToActorWrite,
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup, Scope::GrantRevoked, Scope::GrantDismissed,
        ];
    }

    private static function calendarDestroyCase(Actor $actor, Scope $scope, bool $visible, bool $sharee): OwnershipCase
    {
        $case = OwnershipCase::of(self::CAL_SET, $actor, $scope, match (true) {
            ! $visible => Outcome::NotFound,
            $sharee => Outcome::Dismissed,
            $scope === Scope::OwnGroup && $actor === Actor::Member => Outcome::Forbidden,
            default => Outcome::Allowed,
        })->variant('destroy');

        // JMAP maps group_delete_admin_only onto the forbidden SetError type.
        return $case;
    }

    private function runCase(OwnershipCase $case): void
    {
        if ($case->actor === Actor::Anonymous) {
            $this->runAnonymous($case);

            return;
        }

        match (true) {
            $case->operation === self::SCHED_INVITEES => $this->runInvitees($case),
            $case->variant === 'shared-organizer-copy' => $this->runSharedOrganizerRsvp($case),
            in_array($case->operation, [self::SCHED_INDEX, self::SCHED_RESPOND, self::SCHED_DELETE], true) => $this->runScheduling($case),
            in_array($case->operation, [self::SUB_INDEX, self::SUB_SHOW, self::SUB_REFRESH, self::SUB_DELETE], true) => $this->runSubscription($case),
            $case->operation === self::SUB_STORE => $this->runSubscriptionStore($case),
            $case->operation === self::CAL_SET && in_array($case->variant, ['create', 'create-unknown-group'], true) => $this->runCalendarCreate($case),
            $case->operation === self::CAL_SET && $case->variant === 'body-target' => $this->runCalendarTransfer($case),
            $case->operation === self::EVT_SET && in_array($case->variant, ['direct-read-copy', 'group-write-direct-read'], true) => $this->runDoubleGrant($case),
            default => $this->runTargetCase($case),
        };
    }

    private function runTargetCase(OwnershipCase $case): void
    {
        $withFeed = in_array($case->operation, [self::FEED_GET, self::FEED_POST, self::FEED_DELETE], true);
        // Calendar-level reads, renames, re-shares, and feeds never touch the event.
        $withEvent = ! $withFeed
            && ! in_array($case->operation, [self::CAL_GET, self::CAL_CHANGES], true)
            && ! in_array($case->variant, ['rename', 'reshare'], true);
        $target = $this->seedTarget($case->scope, $case->actor, $withEvent, $withFeed);

        match ($case->operation) {
            self::CAL_GET => $this->runCalendarGet($case, $target),
            self::CAL_CHANGES => $this->runCalendarChanges($case, $target),
            self::CAL_SET => $this->runCalendarSet($case, $target),
            self::EVT_GET => $this->runEventGet($case, $target),
            self::EVT_CHANGES => $this->runEventChanges($case, $target),
            self::EVT_QUERY => $this->runEventQuery($case, $target),
            self::EVT_QUERY_CHANGES => $this->runEventQueryChanges($case, $target),
            self::EVT_SET => $this->runEventSet($case, $target),
            self::IMPORT => $this->runImport($case, $target),
            self::FEED_GET, self::FEED_POST, self::FEED_DELETE => $this->runFeed($case, $target),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    // ---- Target seeding -------------------------------------------------

    /**
     * @return array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}
     */
    private function seedTarget(Scope $scope, Actor $actor, bool $withEvent = true, bool $withFeed = false): array
    {
        $carol = OwnershipPrincipals::CAROL;
        $self = $this->usernameFor($actor);
        $name = 'calendar '.$scope->value;

        [$owner, $groupSlug] = match ($scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, OwnershipPrincipals::OUTSIDERS],
            // The other actor creates it and stays in alumni, so the owner's
            // view still works after this actor leaves.
            Scope::FormerGroup => [$this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin), OwnershipPrincipals::ALUMNI],
            default => [$carol, null],
        };

        $grant = match ($scope) {
            Scope::UserToActorRead, Scope::GroupToNonmemberRead => [$self => ['mayReadItems' => true]],
            Scope::UserToActorWrite, Scope::GroupToNonmemberWrite, Scope::GrantRevoked, Scope::GrantDismissed => [$self => ['mayWriteAll' => true]],
            Scope::UserToActorGroup => ['groups/'.OwnershipPrincipals::CREW => ['mayWriteAll' => true]],
            default => null,
        };

        [$ownerCalendarId, $eventId] = $this->createCalendarWithEvent($owner, 'target-'.$scope->value, $name, $groupSlug, $grant, $withEvent);
        if ($withFeed) {
            $this->requestAsUsername($owner, 'POST', '/calendars/'.$ownerCalendarId.'/feed')->assertSuccessful();
        }

        $actorCalendarId = $grant === null ? $ownerCalendarId : $this->copyIdFor($self, $name);
        switch ($scope) {
            case Scope::GrantRevoked:
                $this->calendarSetAs($owner, ['update' => [$ownerCalendarId => ['shareWith' => [$self => null]]]])
                    ->assertJsonPath('methodResponses.0.1.updated', [$ownerCalendarId => null]);
                break;
            case Scope::GrantDismissed:
                $this->calendarSetAs($self, ['destroy' => [$actorCalendarId]])
                    ->assertJsonPath('methodResponses.0.1.destroyed', [$actorCalendarId]);
                break;
            case Scope::FormerGroup:
                $this->leaveFormerGroup($actor);
                break;
            default:
                break;
        }

        return ['owner' => $owner, 'name' => $name, 'ownerCalendarId' => $ownerCalendarId, 'actorCalendarId' => $actorCalendarId, 'eventId' => $eventId];
    }

    /**
     * One JMAP request as the owner: the calendar (with any grant) and one
     * event in it. Without an event the event id is ''.
     *
     * @param  array<string, mixed>|null  $shareWith
     * @return array{0: string, 1: string} calendar id, event id
     */
    private function createCalendarWithEvent(string $owner, string $calendarId, string $name, ?string $groupSlug, ?array $shareWith, bool $withEvent = true): array
    {
        $calendar = ['id' => $calendarId, 'name' => $name];
        if ($groupSlug !== null) {
            $calendar['groupSlug'] = $groupSlug;
        }
        if ($shareWith !== null) {
            $calendar['shareWith'] = $shareWith;
        }

        $calls = [['Calendar/set', ['accountId' => $owner, 'create' => ['c' => $calendar]], 's0']];
        if ($withEvent) {
            $calls[] = ['CalendarEvent/set', ['accountId' => $owner, 'create' => ['e' => $this->eventPayload($calendarId, 'event in '.$name)]], 's1'];
        }
        $response = $this->jmapAsUsername($owner, $calls);
        $createdId = (string) $response->json('methodResponses.0.1.created.c.id');
        $eventId = (string) $response->json('methodResponses.1.1.created.e.id');
        $this->assertSame($calendarId, $createdId, 'Seeding '.$name.': '.$response->getContent());
        $this->assertSame($withEvent, $eventId !== '', 'Seeding event in '.$name.': '.$response->getContent());

        return [$createdId, $eventId];
    }

    /**
     * @return array<string, mixed>
     */
    private function eventPayload(string $calendarId, string $title): array
    {
        return [
            'calendarIds' => [$calendarId => true],
            'title' => $title,
            'start' => self::START,
            'end' => self::END,
        ];
    }

    private function copyIdFor(string $username, string $name): string
    {
        foreach ($this->calendarRows($username) as $row) {
            if (($row['name'] ?? null) === $name) {
                return (string) $row['id'];
            }
        }

        $this->fail($username.' does not see shared calendar '.$name);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function calendarRows(string $username): array
    {
        $rows = $this->jmapAsUsername($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null, 'properties' => ['id', 'name']], 'g0'],
        ])->json('methodResponses.0.1.list');

        return is_array($rows) ? array_values($rows) : [];
    }

    /**
     * The owner's view of the target, for proving a denied write changed nothing.
     *
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target): array
    {
        $owner = $target['owner'];
        $response = $this->jmapAsUsername($owner, [
            ['Calendar/get', ['accountId' => $owner, 'ids' => [$target['ownerCalendarId']], 'properties' => ['id', 'name', 'color', 'shareWith']], 'a'],
            ['CalendarEvent/query', ['accountId' => $owner, 'filter' => ['inCalendars' => [$target['ownerCalendarId']]]], 'b'],
            ['CalendarEvent/get', ['accountId' => $owner, 'ids' => $target['eventId'] === '' ? [] : [$target['eventId']], 'properties' => ['id', 'title', 'calendarIds', 'start']], 'c'],
        ]);
        $ids = $response->json('methodResponses.1.1.ids');
        if (is_array($ids)) {
            sort($ids);
        }

        return [
            'calendar' => $response->json('methodResponses.0.1.list'),
            'calendarNotFound' => $response->json('methodResponses.0.1.notFound'),
            'eventIds' => $ids,
            'event' => $response->json('methodResponses.2.1.list'),
        ];
    }

    // ---- Requests -------------------------------------------------------

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAsUsername(string $username, array $methodCalls): TestResponse
    {
        return $this->requestAsUsername($username, 'POST', '/jmap', ['using' => self::USING, 'methodCalls' => $methodCalls])->assertOk();
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function calendarSetAs(string $username, array $args): TestResponse
    {
        return $this->jmapAsUsername($username, [['Calendar/set', ['accountId' => $username] + $args, 's0']]);
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function actorCall(OwnershipCase $case, string $method, array $args, string $owner): TestResponse
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? $owner : $this->accountIdFor($case->actor);

        return $this->jmapAs($case->actor, [[$method, ['accountId' => $accountId] + $args, 'c0']], self::USING);
    }

    private function sendIcs(?Actor $actor, string $calendarId, string $ics): TestResponse
    {
        $server = ['CONTENT_TYPE' => 'text/calendar', 'HTTP_ACCEPT' => 'application/json'];
        $token = $actor === null ? null : $this->tokenFor($actor);
        if ($token !== null) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }

        return $this->call('POST', '/api/v1/calendars/events/import?calendarId='.rawurlencode($calendarId), [], [], [], $server, $ics);
    }

    private function icsBody(string $uid, string $title): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ownership-matrix//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20300101T000000Z\r\n"
            ."DTSTART:20300115T100000Z\r\nDTEND:20300115T110000Z\r\nSUMMARY:{$title}\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * @return list<string>
     */
    private static function idsFrom(mixed $rows): array
    {
        if (! is_array($rows)) {
            return [];
        }

        return array_values(array_map(
            static fn (mixed $row): string => is_array($row) ? (string) ($row['id'] ?? '') : (string) $row,
            $rows,
        ));
    }

    // ---- Calendar runners -------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runCalendarGet(OwnershipCase $case, array $target): void
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? $target['owner'] : $this->accountIdFor($case->actor);
        $response = $this->jmapAs($case->actor, [
            ['Calendar/get', ['accountId' => $accountId, 'ids' => [$target['actorCalendarId']]], 'c0'],
            ['Calendar/get', ['accountId' => $accountId, 'ids' => null], 'c1'],
        ], self::USING);
        $this->assertJmapGetOutcome($response, $target['actorCalendarId'], $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['name'], $response->json('methodResponses.0.1.list.0.name'), $case->key());
        }
        if ($case->outcome === Outcome::NotFound) {
            $list = $response->json('methodResponses.1.1.list');
            $this->assertIdsAbsent([$target['ownerCalendarId'], $target['actorCalendarId']], self::idsFrom($list), $case->key());
            $this->assertNotContains($target['name'], array_column(is_array($list) ? $list : [], 'name'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runCalendarChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->actorCall($case, 'Calendar/changes', ['sinceState' => '0'], $target['owner']);
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }

        $args = $response->json('methodResponses.0.1');
        $this->assertSame('Calendar/changes', $response->json('methodResponses.0.0'), $case->key());
        $ids = array_merge(self::idsFrom($args['created'] ?? []), self::idsFrom($args['updated'] ?? []));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorCalendarId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['ownerCalendarId'], $target['actorCalendarId']], $ids, $case->key());
    }

    /**
     * Calendar/set update (rename, reshare), destroy, and the foreign-account update.
     *
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runCalendarSet(OwnershipCase $case, array $target): void
    {
        $id = $target['actorCalendarId'];
        [$operation, $args] = match ($case->variant) {
            'rename', 'foreign-account' => ['update', ['update' => [$id => ['name' => 'renamed by actor']]]],
            'reshare' => ['update', ['update' => [$id => ['shareWith' => [OwnershipPrincipals::DAVE => ['mayReadItems' => true]]]]]],
            'destroy' => ['destroy', ['destroy' => [$id], 'onDestroyRemoveEvents' => true]],
            default => throw new LogicException('No Calendar/set variant '.$case->variant),
        };
        $send = fn (): TestResponse => $this->actorCall($case, 'Calendar/set', $args, $target['owner']);

        if ($case->outcome === Outcome::Allowed && $case->variant === 'rename' && in_array($case->scope, self::SHAREE, true)) {
            // A sharee renames only its own copy; the owner's calendar keeps its name.
            $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target)['calendar'], $send, $case->key());
            $this->assertJmapSetOutcome($response, $operation, $id, $case);

            return;
        }
        if ($case->outcome === Outcome::Allowed) {
            $this->assertJmapSetOutcome($send(), $operation, $id, $case);
            if ($case->variant === 'destroy') {
                $this->assertSame([$target['ownerCalendarId']], $this->ownerSnapshot($target)['calendarNotFound'], $case->key().': calendar still exists.');
            }

            return;
        }

        // Denied and dismissed both leave the owner's calendar and event in place.
        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertJmapSetOutcome($response, $operation, $id, $case);
        if ($case->outcome === Outcome::Dismissed) {
            $names = array_column($this->calendarRows($this->usernameFor($case->actor)), 'name');
            $this->assertNotContains($target['name'], $names, $case->key().': dismissed calendar still listed for the actor.');
        }
    }

    private function runCalendarCreate(OwnershipCase $case): void
    {
        $groupSlug = match ($case->scope) {
            Scope::OwnUser => null,
            Scope::OwnGroup => OwnershipPrincipals::CREW,
            Scope::OtherGroup => OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => OwnershipPrincipals::ALUMNI,
            default => throw new LogicException('No create target for '.$case->scope->value),
        };
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $name = 'created in '.$case->scope->value;
        $payload = ['name' => $name] + ($groupSlug === null ? [] : ['groupSlug' => $groupSlug]);
        $response = $this->actorCall($case, 'Calendar/set', ['create' => ['c' => $payload]], '');
        $this->assertJmapSetOutcome($response, 'create', 'c', $case);

        if ($case->variant === 'create-unknown-group') {
            $unknown = $this->actorCall($case, 'Calendar/set', ['create' => ['c' => ['name' => $name, 'groupSlug' => 'no-such-group']]], '');
            $this->assertSame(
                $response->json('methodResponses.0.1.notCreated'),
                $unknown->json('methodResponses.0.1.notCreated'),
                $case->key().': existing and unknown groups differ.',
            );
        }

        if ($case->outcome !== Outcome::Allowed) {
            $witness = $case->scope === Scope::FormerGroup
                ? $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin)
                : OwnershipPrincipals::CAROL;
            $this->assertNotContains($name, array_column($this->calendarRows($witness), 'name'), $case->key().': calendar created in a group the actor is not in.');
        }
    }

    /**
     * The actor names a group it is not in as the new owner of its own calendar.
     */
    private function runCalendarTransfer(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        [$calendarId] = $this->createCalendarWithEvent($self, 'own-transfer', 'own calendar for transfer', null, null);

        $response = $this->actorCall($case, 'Calendar/set', ['update' => [$calendarId => ['groupSlug' => OwnershipPrincipals::OUTSIDERS]]], '');
        $this->assertJmapSetOutcome($response, 'update', $calendarId, $case);

        $this->assertNotContains('own calendar for transfer', array_column($this->calendarRows(OwnershipPrincipals::CAROL), 'name'), $case->key().': calendar moved into the other group.');
        $own = $this->jmapAsUsername($self, [['Calendar/get', ['accountId' => $self, 'ids' => [$calendarId], 'properties' => ['id', 'scope']], 'g0']]);
        $this->assertSame('personal', $own->json('methodResponses.0.1.list.0.scope'), $case->key().': calendar left the actor.');
    }

    // ---- Event runners ----------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventGet(OwnershipCase $case, array $target): void
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? $target['owner'] : $this->accountIdFor($case->actor);
        $response = $this->jmapAs($case->actor, [
            ['CalendarEvent/get', ['accountId' => $accountId, 'ids' => [$target['eventId']]], 'c0'],
            ['CalendarEvent/get', ['accountId' => $accountId, 'ids' => null], 'c1'],
        ], self::USING);
        $this->assertJmapGetOutcome($response, $target['eventId'], $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('event in '.$target['name'], $response->json('methodResponses.0.1.list.0.title'), $case->key());
        }
        if ($case->outcome === Outcome::NotFound) {
            $this->assertIdsAbsent([$target['eventId']], self::idsFrom($response->json('methodResponses.1.1.list')), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->actorCall($case, 'CalendarEvent/changes', ['sinceState' => '0'], $target['owner']);
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }

        $this->assertSame('CalendarEvent/changes', $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
        $args = $response->json('methodResponses.0.1');
        $ids = array_merge(self::idsFrom($args['created'] ?? []), self::idsFrom($args['updated'] ?? []));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['eventId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['eventId']], $ids, $case->key());
    }

    /**
     * Denied: the calendar filter answers exactly as for a calendar that does
     * not exist, and an unfiltered query leaves the event out.
     *
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventQuery(OwnershipCase $case, array $target): void
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? $target['owner'] : $this->accountIdFor($case->actor);
        $response = $this->jmapAs($case->actor, [
            ['CalendarEvent/query', ['accountId' => $accountId, 'filter' => ['inCalendars' => [$target['actorCalendarId']]]], 'c0'],
            ['CalendarEvent/query', ['accountId' => $accountId, 'filter' => ['inCalendars' => ['no-such-calendar']]], 'c1'],
            ['CalendarEvent/query', ['accountId' => $accountId, 'filter' => []], 'c2'],
        ], self::USING);
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }

        $response->assertOk();
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('CalendarEvent/query', $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
            $this->assertContains($target['eventId'], (array) $response->json('methodResponses.0.1.ids'), $case->key());

            return;
        }

        $this->assertSame(
            array_slice((array) $response->json('methodResponses.1'), 0, 2),
            array_slice((array) $response->json('methodResponses.0'), 0, 2),
            $case->key().': hidden and unknown calendars answer differently.',
        );
        $this->assertIdsAbsent([$target['eventId']], self::idsFrom($response->json('methodResponses.2.1.ids')), $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventQueryChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->actorCall($case, 'CalendarEvent/queryChanges', [
            'sinceQueryState' => '0',
            'filter' => ['inCalendars' => [$target['actorCalendarId']]],
        ], $target['owner']);
        $type = $case->outcome === Outcome::AccountNotFound ? 'accountNotFound' : 'cannotCalculateChanges';
        $this->assertJmapMethodError($response, $type, $case);
        $this->assertStringNotContainsString($target['eventId'], (string) $response->getContent(), $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventSet(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'move-into' || $case->variant === 'move-out') {
            $this->runEventMove($case, $target);

            return;
        }
        if ($case->variant === 'uid-collision') {
            $this->runUidCollision($case, $target);

            return;
        }

        [$operation, $id, $args] = match ($case->variant) {
            'create' => ['create', 'n', ['create' => ['n' => $this->eventPayload($target['actorCalendarId'], 'created by actor')]]],
            'update', 'foreign-account' => ['update', $target['eventId'], ['update' => [$target['eventId'] => ['title' => 'patched by actor']]]],
            'destroy' => ['destroy', $target['eventId'], ['destroy' => [$target['eventId']]]],
            default => throw new LogicException('No CalendarEvent/set variant '.$case->variant),
        };
        $send = fn (): TestResponse => $this->actorCall($case, 'CalendarEvent/set', $args, $target['owner']);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertJmapSetOutcome($send(), $operation, $id, $case);

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertJmapSetOutcome($response, $operation, $id, $case);
    }

    /**
     * move-into: the actor's own event moves into the scope's calendar.
     * move-out: the scope's event moves into the actor's own calendar.
     *
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runEventMove(OwnershipCase $case, array $target): void
    {
        $self = $this->usernameFor($case->actor);
        [$ownCalendarId, $ownEventId] = $this->createCalendarWithEvent($self, 'own-move', 'own calendar for move', null, null);
        [$eventId, $destination] = $case->variant === 'move-into'
            ? [$ownEventId, $target['actorCalendarId']]
            : [$target['eventId'], $ownCalendarId];
        $send = fn (): TestResponse => $this->actorCall($case, 'CalendarEvent/set', ['update' => [$eventId => ['calendarIds' => [$destination => true]]]], $target['owner']);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertJmapSetOutcome($send(), 'update', $eventId, $case);
            $moved = $this->jmapAsUsername($target['owner'], [['CalendarEvent/query', ['accountId' => $target['owner'], 'filter' => ['inCalendars' => [$target['ownerCalendarId']]]], 'q0']]);
            $this->assertContains($eventId, (array) $moved->json('methodResponses.0.1.ids'), $case->key().': event not in the destination.');

            return;
        }

        $ownView = fn (): mixed => $this->jmapAsUsername($self, [['CalendarEvent/query', ['accountId' => $self, 'filter' => ['inCalendars' => [$ownCalendarId]]], 'q0']])->json('methodResponses.0.1.ids');
        $response = $this->assertUnchanged(
            fn (): array => ['owner' => $this->ownerSnapshot($target), 'own' => $ownView()],
            $send,
            $case->key(),
        );
        $this->assertJmapSetOutcome($response, 'update', $eventId, $case);
    }

    /**
     * The actor invites the scope's owner to an event in its own calendar that
     * reuses the uid of the owner's event. The uid is not secret: it travels
     * in every invite and feed. The owner's event must stay as it was.
     *
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runUidCollision(OwnershipCase $case, array $target): void
    {
        $self = $this->usernameFor($case->actor);
        $owner = $target['owner'];
        $uid = (string) $this->jmapAsUsername($owner, [['CalendarEvent/get', ['accountId' => $owner, 'ids' => [$target['eventId']], 'properties' => ['uid']], 'g0']])
            ->json('methodResponses.0.1.list.0.uid');
        $this->assertNotSame('', $uid);
        [$ownCalendarId] = $this->createCalendarWithEvent($self, 'own-invite', 'own calendar for invite', null, null, false);

        $payload = $this->eventPayload($ownCalendarId, 'invite from actor') + [
            'uid' => $uid,
            'participants' => [
                'org' => ['@type' => 'Participant', 'email' => $self.'@example.test', 'roles' => ['owner']],
                'att' => ['@type' => 'Participant', 'email' => $owner.'@example.test', 'roles' => ['attendee'], 'expectReply' => true, 'participationStatus' => 'needs-action'],
            ],
        ];
        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->actorCall($case, 'CalendarEvent/set', ['create' => ['n' => $payload]], $owner),
            $case->key(),
        );
        $this->assertJmapSetOutcome($response, 'create', 'n', $case);
    }

    /**
     * Allowed rows for an actor that holds write access through one path and a
     * read-only copy of the same calendar through another.
     */
    private function runDoubleGrant(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        if ($case->variant === 'direct-read-copy') {
            // Group calendar of crew; a crew member also shares it read-only with the actor.
            $owner = OwnershipPrincipals::DAVE;
            [$calendarId, $eventId] = $this->createCalendarWithEvent($owner, 'target-double', 'double grant', OwnershipPrincipals::CREW, [$self => ['mayReadItems' => true]]);
        } else {
            // carol's calendar, shared read-write with crew and read-only with the actor.
            $owner = OwnershipPrincipals::CAROL;
            [$calendarId, $eventId] = $this->createCalendarWithEvent($owner, 'target-double', 'double grant', null, [
                'groups/'.OwnershipPrincipals::CREW => ['mayWriteAll' => true],
                $self => ['mayReadItems' => true],
            ]);
        }

        $ownerEvent = fn (): mixed => $this->jmapAsUsername($owner, [['CalendarEvent/get', ['accountId' => $owner, 'ids' => [$eventId], 'properties' => ['title', 'calendarIds', 'start']], 'g0']])
            ->json('methodResponses.0.1.list');
        $before = $ownerEvent();

        $response = $this->actorCall($case, 'CalendarEvent/set', ['update' => [$eventId => ['title' => 'patched by actor']]], $owner);
        $this->assertJmapSetOutcome($response, 'update', $eventId, $case);
        if (! array_key_exists($eventId, (array) $response->json('methodResponses.0.1.updated'))) {
            $this->assertSame($before, $ownerEvent(), $case->key().': event changed after a refused update.');

            return;
        }
        $this->assertSame('patched by actor', $ownerEvent()[0]['title'] ?? null, $case->key().': owner does not see the update in '.$calendarId);
    }

    // ---- REST runners -----------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runImport(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->sendIcs($case->actor, $target['actorCalendarId'], $this->icsBody('import-'.$case->scope->value.'@example.test', 'imported by actor'));

        if ($case->outcome === Outcome::Allowed) {
            $response = $send();
            $this->assertRestOutcome($response, $case);
            $this->assertSame(201, $response->getStatusCode(), $case->key());

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array{owner: string, name: string, ownerCalendarId: string, actorCalendarId: string, eventId: string}  $target
     */
    private function runFeed(OwnershipCase $case, array $target): void
    {
        [$method] = explode(' ', $case->operation, 2);
        $path = '/calendars/'.$target['actorCalendarId'].'/feed';
        $ownerFeed = fn (): array => [
            'url' => $this->requestAsUsername($target['owner'], 'GET', '/calendars/'.$target['ownerCalendarId'].'/feed')->json('httpsUrl'),
            'tokens' => CalendarFeedToken::query()->count(),
        ];
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, $path);

        if ($case->outcome === Outcome::Allowed && $method === 'GET') {
            // Reading changes nothing: the publisher's feed stays listed and served.
            $url = (string) $ownerFeed()['url'];
            $this->assertNotSame('', $url, $case->key().': owner has no feed.');
            $response = $this->assertUnchanged($ownerFeed, $send, $case->key());
            $this->assertRestOutcome($response, $case);
            $this->assertSame(1, preg_match('#/calendars/feeds/([A-Za-z0-9]+)$#', $url, $match), $url);
            $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$match[1])->assertOk();
            if ($response->isSuccessful()) {
                $this->assertSame($url, $response->json('httpsUrl'), $case->key());
            } else {
                $this->assertStringNotContainsString($match[1], (string) $response->getContent(), $case->key().': feed token leaked.');
            }

            return;
        }
        if ($case->outcome === Outcome::Allowed) {
            $response = $send();
            $this->assertRestOutcome($response, $case);
            if ($method === 'DELETE') {
                $this->assertSame(404, $this->requestAs($case->actor, 'GET', $path)->getStatusCode(), $case->key().': feed still published.');
            }

            return;
        }

        $url = (string) $ownerFeed()['url'];
        $this->assertNotSame('', $url, $case->key().': owner has no feed.');
        $response = $this->assertUnchanged($ownerFeed, $send, $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertStringNotContainsString(basename($url), (string) $response->getContent(), $case->key().': feed token leaked.');
    }

    private function runAnonymous(OwnershipCase $case): void
    {
        if ($case->operation === self::IMPORT) {
            $this->assertRestOutcome($this->sendIcs(null, 'default', $this->icsBody('anonymous@example.test', 'anonymous')), $case);

            return;
        }

        [$method, $template] = explode(' ', $case->operation, 2);
        $uri = strtr($template, ['{calendarId}' => 'default', '{id}' => 'unknown', '{notificationId}' => 'unknown']);
        $body = match ($case->operation) {
            self::SUB_STORE => ['url' => self::FEED_URL],
            self::SCHED_RESPOND => ['participationStatus' => 'accepted'],
            default => [],
        };
        $this->assertRestOutcome($this->requestAs($case->actor, $method, $uri, $body), $case);
    }

    // ---- Subscriptions ----------------------------------------------------

    private function runSubscription(OwnershipCase $case): void
    {
        $owner = $case->scope === Scope::OwnUser ? $this->usernameFor($case->actor) : OwnershipPrincipals::CAROL;
        $subscriptionId = (string) $this->requestAsUsername($owner, 'POST', '/calendars/subscriptions', ['url' => self::FEED_URL, 'name' => 'subscription of '.$owner])
            ->assertCreated()->json('id');
        $snapshot = fn (): array => [
            'show' => $this->requestAsUsername($owner, 'GET', '/calendars/subscriptions/'.$subscriptionId)->json(),
            'calendars' => array_column($this->calendarRows($owner), 'name'),
        ];

        if ($case->operation === self::SUB_INDEX) {
            $response = $this->requestAs($case->actor, 'GET', '/calendars/subscriptions');
            $response->assertOk();
            $ids = self::idsFrom($response->json('list'));
            $case->outcome === Outcome::Allowed
                ? $this->assertContains($subscriptionId, $ids, $case->key())
                : $this->assertIdsAbsent([$subscriptionId], $ids, $case->key());

            return;
        }

        [$method, $suffix] = match ($case->operation) {
            self::SUB_SHOW => ['GET', ''],
            self::SUB_REFRESH => ['POST', '/refresh'],
            self::SUB_DELETE => ['DELETE', ''],
            default => throw new LogicException('No subscription runner for '.$case->operation),
        };
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, '/calendars/subscriptions/'.$subscriptionId.$suffix);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $response = $this->assertUnchanged($snapshot, $send, $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertStringNotContainsString(self::FEED_URL, (string) $response->getContent(), $case->key());
    }

    private function runSubscriptionStore(OwnershipCase $case): void
    {
        $groupSlug = match ($case->scope) {
            Scope::OwnUser => null,
            Scope::OwnGroup => OwnershipPrincipals::CREW,
            Scope::OtherGroup => OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => OwnershipPrincipals::ALUMNI,
            default => throw new LogicException('No subscription target for '.$case->scope->value),
        };
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $name = 'subscribed in '.$case->scope->value;
        $payload = ['url' => self::FEED_URL, 'name' => $name] + ($groupSlug === null ? [] : ['groupSlug' => $groupSlug]);
        $response = $this->requestAs($case->actor, 'POST', '/calendars/subscriptions', $payload);
        $this->assertRestOutcome($response, $case);

        if ($case->variant === 'unknown-group') {
            $unknown = $this->requestAs($case->actor, 'POST', '/calendars/subscriptions', ['groupSlug' => 'no-such-group'] + $payload);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');
        }

        if ($case->outcome !== Outcome::Allowed) {
            $witness = $case->scope === Scope::FormerGroup
                ? $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin)
                : OwnershipPrincipals::CAROL;
            $this->assertNotContains($name, array_column($this->calendarRows($witness), 'name'), $case->key().': subscription created in a group the actor is not in.');
        }
    }

    // ---- Scheduling -------------------------------------------------------

    private function runInvitees(OwnershipCase $case): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/calendars/scheduling/invitees');
        $this->assertRestOutcome($response, $case);
        $rows = (array) $response->json('list');
        $this->assertNotSame([], $rows, $case->key());
        foreach ($rows as $row) {
            $this->assertIsArray($row);
            $keys = array_keys($row);
            sort($keys);
            $this->assertSame(['email', 'name', 'username'], $keys, $case->key().': invitee rows carry more than a name and an address.');
        }
        $this->assertNotContains(OwnershipPrincipals::CREW, array_column($rows, 'username'), $case->key());
    }

    /**
     * dave invites the attendee (the actor for own-user, carol for other-user).
     */
    private function runScheduling(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $attendee = $case->scope === Scope::OwnUser ? $self : OwnershipPrincipals::CAROL;
        $notificationId = $this->seedInvite($attendee);
        $foreignCalendarId = null;
        if ($case->variant === 'body-target') {
            $notificationId = $this->seedInvite($self);
            [$foreignCalendarId] = $this->createCalendarWithEvent(OwnershipPrincipals::CAROL, 'target-rsvp', 'carol rsvp target', null, null);
        }
        $carolView = fn (): array => [
            'notifications' => $this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/calendars/scheduling/notifications')->json('list'),
            'calendars' => $foreignCalendarId === null ? null : $this->jmapAsUsername(OwnershipPrincipals::CAROL, [
                ['CalendarEvent/query', ['accountId' => OwnershipPrincipals::CAROL, 'filter' => ['inCalendars' => [$foreignCalendarId]]], 'q0'],
            ])->json('methodResponses.0.1.ids'),
        ];

        if ($case->operation === self::SCHED_INDEX) {
            $response = $this->requestAs($case->actor, 'GET', '/calendars/scheduling/notifications');
            $response->assertOk();
            $ids = self::idsFrom($response->json('list'));
            $case->outcome === Outcome::Allowed
                ? $this->assertContains($notificationId, $ids, $case->key())
                : $this->assertIdsAbsent([$notificationId], $ids, $case->key());

            return;
        }

        [$method, $suffix, $body] = match ($case->operation) {
            self::SCHED_RESPOND => ['POST', '/respond', ['participationStatus' => 'accepted'] + ($foreignCalendarId === null ? [] : ['calendarId' => $foreignCalendarId])],
            self::SCHED_DELETE => ['DELETE', '', []],
            default => throw new LogicException('No scheduling runner for '.$case->operation),
        };
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, '/calendars/scheduling/notifications/'.rawurlencode($notificationId).$suffix, $body);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $response = $this->assertUnchanged($carolView, $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * carol organizes an event in a calendar she shares with the actor, and
     * invites the actor. The actor accepts into its own calendar.
     */
    private function runSharedOrganizerRsvp(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $carol = OwnershipPrincipals::CAROL;
        $right = $case->scope === Scope::UserToActorRead ? ['mayReadItems' => true] : ['mayWriteAll' => true];
        // Real accounts get their default calendars on first use; the invite copy lands there.
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$self);
        [$ownCalendarId] = $this->createCalendarWithEvent($self, 'own-rsvp', 'own calendar for rsvp', null, null, false);
        $title = 'carol invites '.$self;
        $this->jmapAsUsername($carol, [
            ['Calendar/set', ['accountId' => $carol, 'create' => ['c' => ['id' => 'carol-organizer', 'name' => 'carol organizer', 'shareWith' => [$self => $right]]]], 's0'],
            ['CalendarEvent/set', ['accountId' => $carol, 'create' => ['e' => $this->eventPayload('carol-organizer', $title) + ['participants' => [
                'org' => ['@type' => 'Participant', 'email' => $carol.'@example.test', 'roles' => ['owner']],
                'att' => ['@type' => 'Participant', 'email' => $self.'@example.test', 'roles' => ['attendee'], 'expectReply' => true, 'participationStatus' => 'needs-action'],
            ]]]], 's1'],
        ]);
        $notificationId = null;
        foreach ((array) $this->requestAs($case->actor, 'GET', '/calendars/scheduling/notifications')->assertOk()->json('list') as $row) {
            if (is_array($row) && ($row['title'] ?? null) === $title) {
                $notificationId = (string) $row['id'];
            }
        }
        $this->assertIsString($notificationId, $case->key().': no notification.');
        $carolIds = fn (): mixed => $this->jmapAsUsername($carol, [['CalendarEvent/query', ['accountId' => $carol, 'filter' => ['inCalendars' => ['carol-organizer']]], 'q0']])->json('methodResponses.0.1.ids');
        $before = $carolIds();
        $this->assertCount(1, (array) $before);
        $carolEvent = fn (): mixed => $this->jmapAsUsername($carol, [['CalendarEvent/get', ['accountId' => $carol, 'ids' => (array) $before, 'properties' => ['title', 'calendarIds', 'start', 'participants']], 'g0']])->json('methodResponses.0.1.list');
        $eventBefore = $carolEvent();

        $response = $this->requestAs($case->actor, 'POST', '/calendars/scheduling/notifications/'.rawurlencode($notificationId).'/respond', [
            'participationStatus' => 'accepted',
            'calendarId' => $ownCalendarId,
        ]);
        $this->assertRestOutcome($response, $case);
        $this->assertSame($before, $carolIds(), $case->key().': the organizer event left the organizer calendar.');
        if (! $response->isSuccessful()) {
            $this->assertSame($eventBefore, $carolEvent(), $case->key().': organizer event changed after a refused answer.');
        }
    }

    /**
     * dave's event with the attendee; returns the attendee's notification id.
     */
    private function seedInvite(string $attendee): string
    {
        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        foreach ([OwnershipPrincipals::DAVE, $attendee] as $username) {
            // Account provisioning; the API has no endpoint that creates the default calendar.
            $provisioner->ensureForPrincipal('principals/'.$username);
        }

        $dave = OwnershipPrincipals::DAVE;
        $this->jmapAsUsername($dave, [['CalendarEvent/set', ['accountId' => $dave, 'create' => ['inv' => [
            'calendarIds' => ['default' => true],
            'title' => 'invite for '.$attendee,
            'start' => self::START,
            'end' => self::END,
            'participants' => [
                'org' => ['@type' => 'Participant', 'email' => $dave.'@example.test', 'name' => 'Dave', 'roles' => ['owner']],
                'att' => [
                    '@type' => 'Participant',
                    'email' => $attendee.'@example.test',
                    'name' => ucfirst($attendee),
                    'roles' => ['attendee'],
                    'expectReply' => true,
                    'participationStatus' => 'needs-action',
                ],
            ],
        ]]], 's0']])->assertJsonPath('methodResponses.0.0', 'CalendarEvent/set');

        $list = $this->requestAsUsername($attendee, 'GET', '/calendars/scheduling/notifications')->assertOk()->json('list');
        foreach ((array) $list as $row) {
            if (is_array($row) && ($row['title'] ?? null) === 'invite for '.$attendee) {
                return (string) $row['id'];
            }
        }

        $this->fail($attendee.' has no notification: '.json_encode($list));
    }
}
