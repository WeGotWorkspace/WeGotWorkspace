<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\CollabMessage;
use App\Models\CollabPeer;
use App\Models\MeetMessage;
use App\Models\MeetPeer;
use App\Models\NotificationDelivery;
use App\Models\PrincipalMessage;
use App\Models\PrincipalPeer;
use App\Models\PushSubscription;
use App\Models\RtcRelayEvent;
use App\Models\User;
use App\Services\Collab\CollabRoomPolicy;
use App\Services\Drive\DriveService;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Quota\QuotaStateCodec;
use App\Services\Rtc\RoomIdCodec;
use App\Services\Rtc\RtcRelayService;
use App\Services\Settings\SettingKeys;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Client;
use Laravel\Passport\Passport;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresMcp;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Ownership matrix for account-scoped records, meetings, and RTC rooms
 * (plan chunk-h-account).
 *
 * Per-user records (notifications, push subscriptions, MCP grants) are seeded
 * for the actor (own-user) or for carol (other-user). Meeting reservations
 * are owned by the actor, by `crew` (reserved by dave), by carol, by
 * `outsiders` (reserved by carol), or by `alumni` (reserved by the other
 * actor, which stays in the group).
 *
 * RTC rooms come in three kinds, named by the case variant:
 * - `meet`: an ad-hoc meeting code reserved by the actor or by carol. The
 *   code is the invite, so a signed-in actor may join carol's meeting; the
 *   target of the peer operations is carol's own participant.
 * - `collab`: the room of a drive document. other-user and other-group
 *   target carol's participant in a document the actor cannot read;
 *   former-group targets the actor's own participant, joined while it was
 *   still in `alumni`.
 * - `principal`: presence rooms, one per Team (#1921). own-group is `groups.crew`,
 *   other-user is dave's participant in `groups.crew`, a room the actor shares
 *   with dave (there is no instance-wide room any more), other-group is carol's
 *   participant in `groups.outsiders`, former-group is the actor's own
 *   participant in `groups.alumni`, joined before it left.
 */
final class AccountOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use ConfiguresMcp;
    use OwnershipAssertions;
    use OwnershipWorld;

    private const LIST_OPS = [
        'GET /notifications',
        'GET /settings/mcp-grants',
        'GET /workspace/state',
    ];

    private const RECORD_WRITE_OPS = [
        'POST /notifications/{id}/ack',
        'POST /notifications/{id}/local-ack',
        'POST /notifications/push/subscriptions',
        'DELETE /notifications/push/subscriptions',
        'DELETE /settings/mcp-grants/{clientId}',
    ];

    private const JOIN = 'POST /rooms/{roomId}/participants';

    private const LEAVE = 'DELETE /rooms/{roomId}/participants/{participantId}';

    private const CONFIGURATION = 'GET /rooms/{roomId}/configuration';

    private const POLL = 'GET /rooms/{roomId}/events';

    private const SEND = 'POST /rooms/{roomId}/events';

    private const CHAT = 'POST /rooms/{roomId}/messages';

    private const RELAY = 'POST /rooms/{roomId}/relay';

    /** Operations that act on one participant of a room. */
    private const PEER_OPS = [self::POLL, self::SEND, self::RELAY, self::LEAVE];

    private const OWN_MEETING_CODE = 'aaaa-bbbb-cccc';

    private const OTHER_MEETING_CODE = 'cccc-dddd-eeee';

    private const FRESH_MEETING_CODE = 'eeee-ffff-gggg';

    private const ACTOR_MEET_PEER = 'actor-peer-1';

    private const CAROL_MEET_PEER = 'carol-peer-1';

    private const UNKNOWN_COLLAB_PEER = '0123456789abcdef';

    private const UNKNOWN_PRINCIPAL_PEER = 'carol-000000';

    private const DOC_NAME = 'ownership.md';

    /** Rooms that are never a guest door: a chat channel, a DM, and a named meeting addressed by its collection id. */
    private const CLOSED_ROOMS = ['meet-channel', 'meet-dm', 'meet-named'];

    private const GUEST_PEER = 'guest-peer-1';

    private const KNOCK_PREFIX = '__wgw_knock__:';

    private const CONTROL_PREFIX = '__wgw_meet_control__:';

    private const ROOM_EVENT_MARKER = 'v=0 ownership-room-event';

    private const LOCAL_ACK_BATCH = 'POST /notifications/local-ack';

    private const READ_ACK_BATCH = 'POST /notifications/ack';

    private const QUOTA_GET = 'JMAP Quota/get';

    private const QUOTA_CHANGES = 'JMAP Quota/changes';

    private const QUOTA_QUERY = 'JMAP Quota/query';

    private const QUOTA_QUERY_CHANGES = 'JMAP Quota/queryChanges';

    private const QUOTA_USING = [JmapCapabilities::CORE, JmapCapabilities::FILENODE, JmapCapabilities::QUOTA];

    private const UNKNOWN_NOTIFICATION_ID = '00000000-0000-4000-8000-000000000000';

    private string $driveDataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        config(['wgw.auth_realm' => 'SabreDAV']);
    }

    protected function tearDown(): void
    {
        if ($this->driveDataDir !== '' && File::isDirectory($this->driveDataDir)) {
            File::deleteDirectory($this->driveDataDir);
        }
        parent::tearDown();
    }

    public static function ownershipCases(): array
    {
        $cases = [];

        foreach (Actor::signedIn() as $actor) {
            foreach ([Scope::OwnUser, Scope::OtherUser] as $scope) {
                $outcome = $scope === Scope::OwnUser ? Outcome::Allowed : Outcome::NotFound;
                foreach (array_merge(self::LIST_OPS, self::RECORD_WRITE_OPS) as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, $outcome);
                }
            }
            // Revoking a client both users granted touches only the actor's grant.
            $cases[] = OwnershipCase::of('DELETE /settings/mcp-grants/{clientId}', $actor, Scope::OtherUser, Outcome::Allowed)
                ->variant('shared-client');

            // The batch ack names its rows in the body. Another user's ids leave
            // that user's rows alone and answer like an unknown id (spec:
            // decided exception "Batch local-ack").
            foreach ([self::LOCAL_ACK_BATCH, self::READ_ACK_BATCH] as $batch) {
                $cases[] = OwnershipCase::of($batch, $actor, Scope::OwnUser, Outcome::Allowed);
                $cases[] = OwnershipCase::of($batch, $actor, Scope::OtherUser, Outcome::NotFound)
                    ->declared(Outcome::Allowed);
            }

            array_push($cases, ...self::quotaCases($actor));
            array_push($cases, ...self::meetingCases($actor));
            array_push($cases, ...self::meetRoomCases($actor));
            array_push($cases, ...self::collabRoomCases($actor));
            array_push($cases, ...self::principalRoomCases($actor));
        }

        array_push($cases, ...self::guestCases());
        array_push($cases, ...self::anonymousCases());
        array_push($cases, ...self::closedRoomCases());

        return array_map(self::applyDecidedExceptions(...), $cases);
    }

    /**
     * Drive quotas: one per root the account writes to, its personal drive
     * and each group drive it is a member of. own-group is `crew`,
     * other-user is carol's personal drive, other-group is `outsiders`, and
     * former-group is `alumni`, read with the same token before the actor
     * left. Admin rows show that the admin role adds no other root.
     *
     * @return list<OwnershipCase>
     */
    private static function quotaCases(Actor $actor): array
    {
        $member = $actor === Actor::Member;
        $scopes = $member
            ? [Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup]
            : [Scope::OtherUser, Scope::OtherGroup];
        $cases = [];
        foreach ([self::QUOTA_GET, self::QUOTA_CHANGES, self::QUOTA_QUERY] as $op) {
            foreach ($scopes as $scope) {
                $visible = in_array($scope, [Scope::OwnUser, Scope::OwnGroup], true);
                $cases[] = OwnershipCase::of($op, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound);
            }
        }
        if (! $member) {
            return $cases;
        }

        // queryChanges is not supported: every scope gets cannotCalculateChanges
        // and no ids. The own-user row proves the answer does not depend on access.
        $cases[] = OwnershipCase::of(self::QUOTA_QUERY_CHANGES, $actor, Scope::OwnUser, Outcome::Allowed);
        $cases[] = OwnershipCase::of(self::QUOTA_QUERY_CHANGES, $actor, Scope::OtherUser, Outcome::NotFound);

        // A foreign accountId is refused before any lookup.
        foreach ([self::QUOTA_GET, self::QUOTA_CHANGES, self::QUOTA_QUERY, self::QUOTA_QUERY_CHANGES] as $op) {
            $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }

        return $cases;
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function meetingCases(Actor $actor): array
    {
        $post = 'POST /meetings/rooms';
        $show = 'GET /meetings/rooms/{roomId}';
        $patch = 'PATCH /meetings/rooms/{roomId}';
        $managed = [Scope::OwnUser, Scope::OwnGroup];
        $cases = [];

        foreach ($managed as $scope) {
            $cases[] = OwnershipCase::of($post, $actor, $scope, Outcome::Allowed);
        }
        // The actor can already see a reserved code (GET is the public guest
        // door), so 403 reveals nothing new.
        $cases[] = OwnershipCase::of($post, $actor, Scope::OtherUser, Outcome::Forbidden)->variant('existing-code');
        $cases[] = OwnershipCase::of($post, $actor, Scope::OtherUser, Outcome::Forbidden)->variant('owner-principal');
        // Claiming a group answers 403 for every group the caller cannot
        // write, existing or not (see unknown-group).
        $cases[] = OwnershipCase::of($post, $actor, Scope::OtherGroup, Outcome::Forbidden);
        $cases[] = OwnershipCase::of($post, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('unknown-group');
        $cases[] = OwnershipCase::of($post, $actor, Scope::FormerGroup, Outcome::Forbidden);

        foreach ([Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup] as $scope) {
            $isManaged = in_array($scope, $managed, true);
            // A meeting code is its own invite: anyone who has it reads the
            // room status. Only managers get the owner fields.
            $cases[] = OwnershipCase::of($show, $actor, $scope, Outcome::Allowed);
            $cases[] = OwnershipCase::of($patch, $actor, $scope, $isManaged ? Outcome::Allowed : Outcome::Forbidden);
        }

        return $cases;
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function meetRoomCases(Actor $actor): array
    {
        $cases = [];
        foreach ([Scope::OwnUser, Scope::OtherUser] as $scope) {
            $own = $scope === Scope::OwnUser;
            // The meeting code is the invite: a signed-in actor joins and reads
            // the configuration of any ad-hoc meeting it has the code of.
            $cases[] = OwnershipCase::of(self::JOIN, $actor, $scope, Outcome::Allowed)->variant('meet');
            $cases[] = OwnershipCase::of(self::CONFIGURATION, $actor, $scope, Outcome::Allowed)->variant('meet');
            // The actor is in the room and sees carol's participant in the
            // roster, so 403 reveals nothing new.
            foreach ([...self::PEER_OPS, self::CHAT] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, $scope, $own ? Outcome::Allowed : Outcome::Forbidden)->variant('meet');
            }
        }

        return $cases;
    }

    /**
     * The join authorizer answers 403 for every document the actor cannot
     * read, existing or not (see collab-unknown-target). Peer operations in
     * such a room must answer the same for a live and an unknown participant.
     *
     * @return list<OwnershipCase>
     */
    private static function collabRoomCases(Actor $actor): array
    {
        $cases = [];
        foreach ([Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup] as $scope) {
            $visible = in_array($scope, [Scope::OwnUser, Scope::OwnGroup], true);
            $roomOutcome = $visible ? Outcome::Allowed : Outcome::Forbidden;
            $cases[] = OwnershipCase::of(self::JOIN, $actor, $scope, $roomOutcome)->variant('collab');
            $cases[] = OwnershipCase::of(self::CONFIGURATION, $actor, $scope, $roomOutcome)->variant('collab');
            foreach (self::PEER_OPS as $op) {
                $cases[] = OwnershipCase::of($op, $actor, $scope, self::peerOpOutcome($op, $scope, $visible))->variant('collab');
            }
        }
        $cases[] = OwnershipCase::of(self::JOIN, $actor, Scope::OtherUser, Outcome::Forbidden)->variant('collab-unknown-target');

        return $cases;
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function principalRoomCases(Actor $actor): array
    {
        $cases = [
            OwnershipCase::of(self::JOIN, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('principal'),
            // Group rooms answer 403 for every group the caller is not in,
            // existing or not (see principal-unknown-group).
            OwnershipCase::of(self::JOIN, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('principal'),
            OwnershipCase::of(self::JOIN, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('principal-unknown-group'),
            OwnershipCase::of(self::JOIN, $actor, Scope::FormerGroup, Outcome::Forbidden)->variant('principal'),
            OwnershipCase::of(self::CONFIGURATION, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('principal'),
            OwnershipCase::of(self::CONFIGURATION, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('principal'),
            OwnershipCase::of(self::CONFIGURATION, $actor, Scope::FormerGroup, Outcome::Forbidden)->variant('principal'),
        ];
        foreach ([Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup] as $scope) {
            foreach (self::PEER_OPS as $op) {
                $cases[] = OwnershipCase::of($op, $actor, $scope, self::peerOpOutcome($op, $scope, $scope === Scope::OwnGroup))->variant('principal');
            }
        }

        return $cases;
    }

    /**
     * A participant that lost access to the room may still remove its own
     * row: that ends its presence and reveals nothing.
     */
    private static function peerOpOutcome(string $op, Scope $scope, bool $visible): Outcome
    {
        if ($visible || ($scope === Scope::FormerGroup && $op === self::LEAVE)) {
            return Outcome::Allowed;
        }

        return Outcome::Forbidden;
    }

    /**
     * Guest rows use a guest-role JWT that is not bound to any link.
     *
     * @return list<OwnershipCase>
     */
    private static function guestCases(): array
    {
        $guest = Actor::Guest;

        return [
            // Meetings are a user feature; a guest only reads the status.
            OwnershipCase::of('POST /meetings/rooms', $guest, Scope::None, Outcome::Forbidden),
            OwnershipCase::of('GET /meetings/rooms/{roomId}', $guest, Scope::OtherUser, Outcome::Allowed),
            OwnershipCase::of('PATCH /meetings/rooms/{roomId}', $guest, Scope::OtherUser, Outcome::Forbidden),
            // A reserved code admits guests only through the lobby.
            OwnershipCase::of(self::JOIN, $guest, Scope::OtherUser, Outcome::Forbidden)->withCode('knock_required')->variant('meet'),
            // A link guest's token is no account: rooms treat it as not signed in.
            OwnershipCase::of(self::POLL, $guest, Scope::OtherUser, Outcome::Unauthenticated)->variant('meet'),
            OwnershipCase::of(self::CHAT, $guest, Scope::OtherUser, Outcome::Unauthenticated)->variant('meet'),
            OwnershipCase::of(self::JOIN, $guest, Scope::OtherUser, Outcome::Unauthenticated)->variant('collab'),
            OwnershipCase::of(self::CONFIGURATION, $guest, Scope::OtherUser, Outcome::Unauthenticated)->variant('collab'),
            // Presence rooms are for accounts only.
            OwnershipCase::of(self::JOIN, $guest, Scope::None, Outcome::Unauthenticated)->variant('principal'),
            OwnershipCase::of(self::CONFIGURATION, $guest, Scope::None, Outcome::Unauthenticated)->variant('principal'),
        ];
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function anonymousCases(): array
    {
        $anonymous = Actor::Anonymous;
        $cases = [];
        foreach ([...self::LIST_OPS, ...self::RECORD_WRITE_OPS, self::LOCAL_ACK_BATCH, self::READ_ACK_BATCH, self::QUOTA_GET, self::QUOTA_CHANGES, self::QUOTA_QUERY, self::QUOTA_QUERY_CHANGES, 'POST /meetings/rooms', 'PATCH /meetings/rooms/{roomId}'] as $op) {
            $cases[] = OwnershipCase::of($op, $anonymous, Scope::OtherUser, Outcome::Unauthenticated);
        }
        $cases[] = OwnershipCase::of('GET /meetings/rooms/{roomId}', $anonymous, Scope::OtherUser, Outcome::Allowed);
        $cases[] = OwnershipCase::of(self::JOIN, $anonymous, Scope::OtherUser, Outcome::Forbidden)->withCode('knock_required')->variant('meet');
        $cases[] = OwnershipCase::of(self::CHAT, $anonymous, Scope::OtherUser, Outcome::Unauthenticated)->variant('meet');
        foreach ([self::JOIN, self::CONFIGURATION, ...self::PEER_OPS] as $op) {
            $cases[] = OwnershipCase::of($op, $anonymous, Scope::OtherUser, Outcome::Unauthenticated)->variant('collab');
        }
        $cases[] = OwnershipCase::of(self::JOIN, $anonymous, Scope::None, Outcome::Unauthenticated)->variant('principal');

        return $cases;
    }

    /**
     * Channel, DM, and named-meeting rooms owned by carol. Guests are refused
     * on all of them, knock or not.
     *
     * @return list<OwnershipCase>
     */
    private static function closedRoomCases(): array
    {
        $cases = [];
        foreach (self::CLOSED_ROOMS as $room) {
            foreach ([self::JOIN, self::POLL, self::CHAT, self::RELAY] as $op) {
                $cases[] = OwnershipCase::of($op, Actor::Guest, Scope::OtherUser, Outcome::Forbidden)->variant($room);
            }
            $cases[] = OwnershipCase::of(self::JOIN, Actor::Anonymous, Scope::OtherUser, Outcome::Forbidden)->variant($room);
        }

        return $cases;
    }

    /**
     * Rows that follow a product decision instead of the default denial (see the
     * spec's "Decided exceptions to the defaults").
     */
    private static function applyDecidedExceptions(OwnershipCase $case): OwnershipCase
    {
        $signedIn = in_array($case->actor, Actor::signedIn(), true);
        // A push endpoint someone else registered gets a separate record for the caller,
        // and deleting by that endpoint removes only the caller's own record. Neither
        // touches the other account's subscription, which the runner checks.
        if ($signedIn && $case->scope === Scope::OtherUser && in_array($case->operation, [
            'POST /notifications/push/subscriptions',
            'DELETE /notifications/push/subscriptions',
        ], true)) {
            return $case->declared(Outcome::Allowed);
        }

        return $case;
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

    // ---- Self exemptions: each ignores ids named in the request ------------

    public function test_me_ignores_a_requested_username(): void
    {
        $response = $this->requestAs(Actor::Member, 'GET', '/me?username=carol&principal=principals/carol')->assertOk();

        $this->assertSame(OwnershipPrincipals::MEMBER, $response->json('username'));
    }

    public function test_files_context_ignores_a_requested_principal(): void
    {
        $response = $this->requestAs(Actor::Member, 'GET', '/files/context?username=carol&principal=principals/carol&path=/users/carol')->assertOk();

        $this->assertSame(OwnershipPrincipals::MEMBER, $response->json('username') ?? $response->json('data.username'));
        $this->assertStringNotContainsString('"carol"', (string) $response->getContent());
    }

    public function test_settings_state_ignores_a_requested_username(): void
    {
        $response = $this->requestAs(Actor::Member, 'GET', '/settings/state?username=carol')->assertOk();

        $this->assertSame(OwnershipPrincipals::MEMBER, $response->json('user.username'));
    }

    public function test_settings_profile_ignores_a_username_in_the_body(): void
    {
        $carolBefore = $this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/settings/state')->assertOk()->json('user');

        $response = $this->requestAs(Actor::Member, 'PUT', '/settings/profile', [
            'username' => OwnershipPrincipals::CAROL,
            'displayName' => 'Renamed by member',
        ])->assertOk();

        $this->assertSame(OwnershipPrincipals::MEMBER, $response->json('user.username'));
        $this->assertSame('Renamed by member', $response->json('user.displayName'));
        $this->assertSame($carolBefore, $this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/settings/state')->json('user'));
    }

    public function test_jmap_session_ignores_a_requested_account(): void
    {
        $response = $this->requestAs(Actor::Member, 'GET', '/jmap/session?accountId=carol&username=carol')->assertOk();

        $this->assertSame([OwnershipPrincipals::MEMBER], array_keys((array) $response->json('accounts')));
        $this->assertSame(OwnershipPrincipals::MEMBER, $response->json('username'));
    }

    // ---- Dispatch -------------------------------------------------------

    private function runCase(OwnershipCase $case): void
    {
        if (in_array($case->variant, self::CLOSED_ROOMS, true)) {
            $this->runClosedRoom($case);

            return;
        }

        match ($case->operation) {
            'GET /notifications' => $this->runNotificationList($case),
            'POST /notifications/{id}/ack', 'POST /notifications/{id}/local-ack' => $this->runNotificationAck($case),
            self::LOCAL_ACK_BATCH, self::READ_ACK_BATCH => $this->runNotificationAckBatch($case),
            self::QUOTA_GET, self::QUOTA_CHANGES, self::QUOTA_QUERY, self::QUOTA_QUERY_CHANGES => $this->runQuota($case),
            'POST /notifications/push/subscriptions' => $this->runPushStore($case),
            'DELETE /notifications/push/subscriptions' => $this->runPushDestroy($case),
            'GET /settings/mcp-grants' => $this->runGrantList($case),
            'DELETE /settings/mcp-grants/{clientId}' => $this->runGrantRevoke($case),
            'GET /workspace/state' => $this->runWorkspaceState($case),
            'POST /meetings/rooms' => $this->runMeetingCreate($case),
            'GET /meetings/rooms/{roomId}' => $this->runMeetingShow($case),
            'PATCH /meetings/rooms/{roomId}' => $this->runMeetingPatch($case),
            self::JOIN => $this->runJoin($case),
            self::CONFIGURATION => $this->runConfiguration($case),
            self::POLL, self::SEND, self::CHAT, self::RELAY, self::LEAVE => $this->runPeerOperation($case),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    /**
     * The user that owns a per-user record in this scope.
     */
    private function recordOwner(OwnershipCase $case): string
    {
        return $case->scope === Scope::OwnUser ? $this->usernameFor($case->actor) : OwnershipPrincipals::CAROL;
    }

    // ---- Notifications ----------------------------------------------------

    private function seedNotification(string $recipient): string
    {
        $tag = 'docs.shared:ownership-'.$recipient;
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: OwnershipPrincipals::DAVE,
            domain: 'docs',
            action: 'shared',
            target: '/users/dave/ownership-'.$recipient.'.md',
            data: [
                'recipients' => [$recipient],
                'title' => 'shared with '.$recipient,
                'navigate' => '/docs',
                'tag' => $tag,
            ],
        ));

        foreach ($this->notificationRows($recipient) as $row) {
            if (($row['tag'] ?? null) === $tag) {
                return (string) $row['id'];
            }
        }

        $this->fail('Notification for '.$recipient.' was not created.');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function notificationRows(string $username): array
    {
        $rows = $this->requestAsUsername($username, 'GET', '/notifications')->assertOk()->json('list');

        return is_array($rows) ? array_values($rows) : [];
    }

    /**
     * The owner's view of one notification plus its local delivery ack.
     *
     * @return array<string, mixed>
     */
    private function notificationSnapshot(string $owner, string $id): array
    {
        $row = null;
        foreach ($this->notificationRows($owner) as $candidate) {
            if (($candidate['id'] ?? null) === $id) {
                $row = $candidate;
            }
        }

        return [
            'readAt' => is_array($row) ? $row['readAt'] : 'missing',
            'localAckedAt' => NotificationDelivery::query()
                ->where('notification_id', $id)
                ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
                ->value('acked_at'),
        ];
    }

    private function runNotificationList(OwnershipCase $case): void
    {
        $id = $this->seedNotification($case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case));
        $response = $this->requestAs($case->actor, 'GET', '/notifications?username=carol&principal=carol');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response->assertOk();
        $ids = array_map('strval', array_column((array) $response->json('list'), 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($id, $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$id], $ids, $case->key());
        $this->assertSame(0, $response->json('unreadCount'), $case->key().': unread count includes another user.');
    }

    private function runNotificationAck(OwnershipCase $case): void
    {
        $owner = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case);
        $id = $this->seedNotification($owner);
        $suffix = str_ends_with($case->operation, '/local-ack') ? '/local-ack' : '/ack';
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/notifications/'.$id.$suffix);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $after = $this->notificationSnapshot($owner, $id);
            $this->assertNotNull($after['localAckedAt'], $case->key().': local delivery not acknowledged.');
            if ($suffix === '/ack') {
                $this->assertNotNull($after['readAt'], $case->key().': notification not marked read.');
            }

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->notificationSnapshot($owner, $id), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    private function runNotificationAckBatch(OwnershipCase $case): void
    {
        $owner = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case);
        $id = $this->seedNotification($owner);
        $read = $case->operation === self::READ_ACK_BATCH;
        $path = $read ? '/notifications/ack' : '/notifications/local-ack';
        $send = fn (string $target): TestResponse => $this->requestAs($case->actor, 'POST', $path, ['ids' => [$target]]);

        if ($case->outcome === Outcome::Allowed && $case->scope === Scope::OwnUser) {
            $this->assertRestOutcome($send($id), $case);
            $after = $this->notificationSnapshot($owner, $id);
            $this->assertNotNull($after['localAckedAt'], $case->key().': local delivery not acknowledged.');
            if ($read) {
                $this->assertNotNull($after['readAt'], $case->key().': notification not marked read.');
            } else {
                $this->assertNull($after['readAt'], $case->key().': local ack marked the notification read.');
            }

            return;
        }

        // Another user's id: the request succeeds or is denied, but the owner's
        // delivery stays unacknowledged either way.
        $this->assertNull($this->notificationSnapshot($owner, $id)['localAckedAt'], $case->key().': seeded delivery already acknowledged.');
        $response = $this->assertUnchanged(fn () => $this->notificationSnapshot($owner, $id), fn () => $send($id), $case->key());
        $this->assertRestOutcome($response, $case);
        if ($case->actor !== Actor::Anonymous) {
            // Another user's id answers exactly like an id that does not exist.
            $this->assertIdenticalAnswer($response, $send(self::UNKNOWN_NOTIFICATION_ID), $case);
        }
    }

    // ---- Quotas ---------------------------------------------------------------

    private function runQuota(OwnershipCase $case): void
    {
        $this->app->instance(FreeSpaceSource::class, new class implements FreeSpaceSource
        {
            public function freeBytes(Filesystem $disk): ?int
            {
                return 1_000_000;
            }
        });
        $this->ensureDriveDataDir();
        $method = substr($case->operation, strlen('JMAP '));

        if ($case->actor === Actor::Anonymous) {
            $call = [$method, ['accountId' => OwnershipPrincipals::CAROL, 'ids' => null, 'sinceState' => 'q1.e30', 'sinceQueryState' => 'q1.e30'], 'q'];
            $this->assertRestOutcome($this->jmapAs($case->actor, [$call], self::QUOTA_USING), $case);

            return;
        }

        $self = $this->usernameFor($case->actor);
        $carol = $this->quotaListing(OwnershipPrincipals::CAROL);
        if ($case->variant === 'foreign-account') {
            $this->runQuotaForeignAccount($case, $method, $carol);

            return;
        }

        // The actor's own listing, with the same token the request uses.
        $own = $this->quotaListing($self);
        [$name, $listing] = match ($case->scope) {
            Scope::OwnUser => ['Personal drive', $own],
            Scope::OwnGroup => [ucfirst(OwnershipPrincipals::CREW), $own],
            Scope::OtherUser => ['Personal drive', $carol],
            Scope::OtherGroup => [ucfirst(OwnershipPrincipals::OUTSIDERS), $carol],
            Scope::FormerGroup => [ucfirst(OwnershipPrincipals::ALUMNI), $own],
            default => throw new LogicException('No quota for '.$case->scope->value),
        };
        $target = $listing['ids'][$name] ?? null;
        $this->assertIsString($target, $case->key().': fixture quota '.$name.' missing.');
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        match ($method) {
            'Quota/get' => $this->runQuotaGet($case, $self, $target),
            'Quota/changes' => $this->runQuotaChanges($case, $self, $target, $own['state']),
            'Quota/query' => $this->runQuotaQuery($case, $self, $target, $name),
            default => $this->runQuotaQueryChanges($case, $self, $target, $listing['state']),
        };
    }

    /**
     * One account's quotas as its owner sees them.
     *
     * @return array{state: string, ids: array<string, string>} ids keyed by quota name
     */
    private function quotaListing(string $username): array
    {
        $response = $this->requestAsUsername($username, 'POST', '/jmap', [
            'using' => self::QUOTA_USING,
            'methodCalls' => [['Quota/get', ['accountId' => $username, 'ids' => null], 'q']],
        ])->assertOk();
        $ids = [];
        foreach ((array) $response->json('methodResponses.0.1.list') as $quota) {
            $ids[(string) $quota['name']] = (string) $quota['id'];
        }

        return ['state' => (string) $response->json('methodResponses.0.1.state'), 'ids' => $ids];
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function quotaJmap(OwnershipCase $case, array $calls): TestResponse
    {
        return $this->jmapAs($case->actor, $calls, self::QUOTA_USING)->assertOk();
    }

    private function runQuotaGet(OwnershipCase $case, string $self, string $target): void
    {
        $response = $this->quotaJmap($case, [
            ['Quota/get', ['accountId' => $self, 'ids' => [$target]], 'byId'],
            ['Quota/get', ['accountId' => $self, 'ids' => null], 'all'],
        ]);
        $this->assertJmapGetOutcome($response, $target, $case);

        $all = array_map('strval', array_column((array) $response->json('methodResponses.1.1.list'), 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target, $all, $case->key().': quota missing from the full list.');

            return;
        }
        $this->assertIdsAbsent([$target], $all, $case->key());
    }

    /**
     * Own rows start from an empty state, so every current quota is created.
     * former-group starts from the state read before the actor left: the
     * group's quota may only come back as destroyed.
     */
    private function runQuotaChanges(OwnershipCase $case, string $self, string $target, string $stateBeforeLeaving): void
    {
        $since = $case->scope === Scope::FormerGroup ? $stateBeforeLeaving : QuotaStateCodec::encode([]);
        $response = $this->quotaJmap($case, [['Quota/changes', ['accountId' => $self, 'sinceState' => $since], 'c']]);
        $this->assertSame('Quota/changes', $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
        $args = (array) $response->json('methodResponses.0.1');
        $created = array_map('strval', (array) ($args['created'] ?? []));
        $updated = array_map('strval', (array) ($args['updated'] ?? []));
        $destroyed = array_map('strval', (array) ($args['destroyed'] ?? []));

        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target, $created, $case->key().': quota missing from created.');

            return;
        }
        $this->assertIdsAbsent([$target], [...$created, ...$updated], $case->key());
        if ($case->scope !== Scope::FormerGroup) {
            $this->assertIdsAbsent([$target], $destroyed, $case->key());
        }
    }

    private function runQuotaQuery(OwnershipCase $case, string $self, string $target, string $name): void
    {
        $response = $this->quotaJmap($case, [
            ['Quota/query', ['accountId' => $self, 'calculateTotal' => true], 'all'],
            ['Quota/query', ['accountId' => $self, 'filter' => ['name' => $name]], 'named'],
        ]);
        $this->assertSame('Quota/query', $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
        $all = array_map('strval', (array) $response->json('methodResponses.0.1.ids'));
        $named = array_map('strval', (array) $response->json('methodResponses.1.1.ids'));

        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target, $all, $case->key().': quota missing from the query.');
            $this->assertContains($target, $named, $case->key().': quota missing from the name filter.');

            return;
        }
        $this->assertIdsAbsent([$target], [...$all, ...$named], $case->key());
        $this->assertSame(count($all), $response->json('methodResponses.0.1.total'), $case->key().': total counts hidden quotas.');
    }

    /**
     * Sent with the state of the quota's owner, so a hidden quota id is in
     * the request; the answer must not depend on it.
     */
    private function runQuotaQueryChanges(OwnershipCase $case, string $self, string $target, string $ownerState): void
    {
        $response = $this->quotaJmap($case, [['Quota/queryChanges', ['accountId' => $self, 'sinceQueryState' => $ownerState], 'q']]);
        $this->assertJmapMethodError($response, 'cannotCalculateChanges', $case);
        $this->assertStringNotContainsString($target, (string) $response->getContent(), $case->key());
    }

    /**
     * @param  array{state: string, ids: array<string, string>}  $carol
     */
    private function runQuotaForeignAccount(OwnershipCase $case, string $method, array $carol): void
    {
        $carolIds = array_values($carol['ids']);
        $this->assertNotSame([], $carolIds, $case->key().': carol has no quotas.');
        $args = match ($method) {
            'Quota/get' => ['ids' => $carolIds],
            'Quota/changes' => ['sinceState' => QuotaStateCodec::encode([])],
            'Quota/query' => ['calculateTotal' => true],
            default => ['sinceQueryState' => $carol['state']],
        };
        $response = $this->quotaJmap($case, [[$method, ['accountId' => OwnershipPrincipals::CAROL] + $args, 'q']]);
        $this->assertJmapMethodError($response, 'accountNotFound', $case);
        $this->assertStringNotContainsString('dq-', (string) $response->getContent(), $case->key().': quota id in the answer.');
    }

    // ---- Push subscriptions -------------------------------------------------

    private function pushEndpoint(string $username): string
    {
        return 'https://fcm.googleapis.com/fcm/send/ownership-'.$username;
    }

    /**
     * @return array{endpoint: string, keys: array{p256dh: string, auth: string}}
     */
    private function pushPayload(string $endpoint, string $keySuffix): array
    {
        return ['endpoint' => $endpoint, 'keys' => ['p256dh' => 'p256dh-'.$keySuffix, 'auth' => 'auth-'.$keySuffix]];
    }

    /**
     * Push subscriptions have no read endpoint; the rows are the owner's view.
     *
     * @return list<array<string, mixed>>
     */
    private function pushSnapshot(string $username): array
    {
        return array_values(PushSubscription::query()
            ->where('principal', $username)
            ->orderBy('id')
            ->get(['id', 'endpoint', 'p256dh', 'auth', 'updated_at'])
            ->map(static fn (PushSubscription $row): array => [
                'id' => $row->id,
                'endpoint' => $row->endpoint,
                'p256dh' => $row->p256dh,
                'auth' => $row->auth,
                'updated_at' => (string) $row->updated_at,
            ])
            ->all());
    }

    private function seedPushSubscription(string $owner): string
    {
        $endpoint = $this->pushEndpoint($owner);
        $this->requestAsUsername($owner, 'POST', '/notifications/push/subscriptions', $this->pushPayload($endpoint, $owner))->assertCreated();

        return $endpoint;
    }

    private function runPushStore(OwnershipCase $case): void
    {
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($this->requestAs($case->actor, 'POST', '/notifications/push/subscriptions', $this->pushPayload($this->pushEndpoint('anonymous'), 'anonymous')), $case);

            return;
        }

        $self = $this->usernameFor($case->actor);
        if ($case->outcome === Outcome::Allowed && $case->scope !== Scope::OtherUser) {
            $this->assertRestOutcome($this->requestAs($case->actor, 'POST', '/notifications/push/subscriptions', $this->pushPayload($this->pushEndpoint($self), $self)), $case);
            $this->assertSame([$this->pushEndpoint($self)], array_column($this->pushSnapshot($self), 'endpoint'), $case->key());

            return;
        }

        // The actor stores carol's endpoint with keys of its own.
        $endpoint = $this->seedPushSubscription(OwnershipPrincipals::CAROL);
        $response = $this->assertUnchanged(
            fn () => $this->pushSnapshot(OwnershipPrincipals::CAROL),
            fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/notifications/push/subscriptions', $this->pushPayload($endpoint, $self)),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
    }

    private function runPushDestroy(OwnershipCase $case): void
    {
        $owner = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case);
        $endpoint = $this->seedPushSubscription($owner);
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/notifications/push/subscriptions', ['endpoint' => $endpoint]);

        if ($case->outcome === Outcome::Allowed && $case->scope !== Scope::OtherUser) {
            $this->assertRestOutcome($send(), $case);
            $this->assertSame([], $this->pushSnapshot($owner), $case->key().': subscription still stored.');

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->pushSnapshot($owner), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    // ---- MCP grants -----------------------------------------------------------

    private function seedGrant(string $username, string $clientName): string
    {
        $user = User::query()->where('username', $username)->firstOrFail();
        $client = $this->mcpClient($clientName, 'https://'.strtolower($clientName).'.example');
        $this->issueMcpGrant($user, $client);

        return (string) $client->getKey();
    }

    /**
     * @return list<string>
     */
    private function grantClientIds(string $username): array
    {
        $grants = $this->requestAsUsername($username, 'GET', '/settings/mcp-grants')->assertOk()->json('grants');

        return array_map('strval', array_column(is_array($grants) ? $grants : [], 'clientId'));
    }

    private function runGrantList(OwnershipCase $case): void
    {
        $owner = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case);
        $clientId = $this->seedGrant($owner, 'Assistant');
        $response = $this->requestAs($case->actor, 'GET', '/settings/mcp-grants?username=carol');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response->assertOk();
        $ids = array_map('strval', array_column((array) $response->json('grants'), 'clientId'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($clientId, $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$clientId], $ids, $case->key());
    }

    private function runGrantRevoke(OwnershipCase $case): void
    {
        $owner = $case->actor === Actor::Anonymous ? OwnershipPrincipals::CAROL : $this->recordOwner($case);
        $clientId = $this->seedGrant($owner, 'Assistant');
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/settings/mcp-grants/'.$clientId);

        if ($case->variant === 'shared-client') {
            $self = $this->usernameFor($case->actor);
            $user = User::query()->where('username', $self)->firstOrFail();
            $this->issueMcpGrant($user, $this->mcpClientById($clientId));
            $response = $this->assertUnchanged(fn () => $this->grantClientIds(OwnershipPrincipals::CAROL), $send, $case->key());
            $this->assertRestOutcome($response, $case);
            $this->assertNotContains($clientId, $this->grantClientIds($self), $case->key().': actor grant still listed.');

            return;
        }
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $this->assertNotContains($clientId, $this->grantClientIds($owner), $case->key().': grant still listed.');

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->grantClientIds($owner), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    private function mcpClientById(string $clientId): Client
    {
        $client = Passport::client()->newQuery()->findOrFail($clientId);
        $this->assertInstanceOf(Client::class, $client);

        return $client;
    }

    // ---- Workspace state ------------------------------------------------------

    private function runWorkspaceState(OwnershipCase $case): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/workspace/state?username=carol&principal=carol');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response->assertOk();
        $self = $this->usernameFor($case->actor);
        $this->assertSame($self, $response->json('username'), $case->key());
        $this->assertSame($case->actor === Actor::Admin, $response->json('isAdmin'), $case->key());
    }

    // ---- Meetings ---------------------------------------------------------------

    /**
     * @return array{code: string, reserver: string}
     */
    private function seedReservation(Scope $scope, Actor $actor): array
    {
        [$reserver, $ownerPrincipal, $code] = match ($scope) {
            Scope::OwnUser => [$this->usernameFor($actor), 'u:'.$this->usernameFor($actor), self::OWN_MEETING_CODE],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, 'groups/'.OwnershipPrincipals::CREW, self::OTHER_MEETING_CODE],
            Scope::OtherUser, Scope::None => [OwnershipPrincipals::CAROL, 'u:'.OwnershipPrincipals::CAROL, self::OTHER_MEETING_CODE],
            Scope::OtherGroup => [OwnershipPrincipals::CAROL, 'groups/'.OwnershipPrincipals::OUTSIDERS, self::OTHER_MEETING_CODE],
            Scope::FormerGroup => [$this->otherActorUsername($actor), 'groups/'.OwnershipPrincipals::ALUMNI, self::OTHER_MEETING_CODE],
            default => throw new LogicException('No reservation for '.$scope->value),
        };

        $this->requestAsUsername($reserver, 'POST', '/meetings/rooms', [
            'room' => $code,
            'ownerPrincipal' => $ownerPrincipal,
            'expiresAt' => Carbon::now('UTC')->addDays(7)->startOfSecond()->toISOString(),
        ])->assertCreated();

        if ($scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($actor);
        }

        return ['code' => $code, 'reserver' => $reserver];
    }

    private function otherActorUsername(Actor $actor): string
    {
        return $this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin);
    }

    /**
     * The reserver's own view of the reservation.
     *
     * @param  array{code: string, reserver: string}  $reservation
     * @return array<string, mixed>
     */
    private function reservationSnapshot(array $reservation): array
    {
        $response = $this->requestAsUsername($reservation['reserver'], 'GET', '/meetings/rooms/'.$reservation['code']);

        return [
            'status' => $response->getStatusCode(),
            'ownerPrincipal' => $response->json('ownerPrincipal'),
            'createdBy' => $response->json('createdBy'),
            'expiresAt' => $response->json('expiresAt'),
        ];
    }

    private function runMeetingCreate(OwnershipCase $case): void
    {
        if ($case->variant === 'existing-code') {
            $reservation = $this->seedReservation(Scope::OtherUser, $case->actor);
            $self = 'u:'.$this->usernameFor($case->actor);
            $response = $this->assertUnchanged(
                fn () => $this->reservationSnapshot($reservation),
                function () use ($case, $reservation, $self): TestResponse {
                    $first = $this->requestAs($case->actor, 'POST', '/meetings/rooms', [
                        'room' => $reservation['code'],
                        'ownerPrincipal' => $self,
                        'expiresAt' => Carbon::now('UTC')->subDay()->toISOString(),
                    ]);
                    $this->requestAs($case->actor, 'POST', '/meetings/rooms', [
                        'room' => $reservation['code'],
                        'ownerPrincipal' => $self,
                    ]);

                    return $first;
                },
                $case->key(),
            );
            $this->assertRestOutcome($response, $case);

            return;
        }

        $self = $case->actor === Actor::Guest || $case->actor === Actor::Anonymous ? null : $this->usernameFor($case->actor);
        $ownerPrincipal = match ($case->scope) {
            Scope::OwnUser => 'u:'.$self,
            Scope::OwnGroup, Scope::None => 'groups/'.OwnershipPrincipals::CREW,
            Scope::OtherUser => 'u:'.OwnershipPrincipals::CAROL,
            Scope::OtherGroup => 'groups/'.OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => 'groups/'.OwnershipPrincipals::ALUMNI,
            default => throw new LogicException('No owner principal for '.$case->scope->value),
        };
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $body = ['room' => self::FRESH_MEETING_CODE, 'ownerPrincipal' => $ownerPrincipal];
        $response = $this->requestAs($case->actor, 'POST', '/meetings/rooms', $body);
        $this->assertRestOutcome($response, $case);

        if ($case->variant === 'unknown-group') {
            $unknown = $this->requestAs($case->actor, 'POST', '/meetings/rooms', ['room' => self::FRESH_MEETING_CODE, 'ownerPrincipal' => 'groups/no-such-group']);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');
        }

        $status = $this->requestAsUsername(OwnershipPrincipals::DAVE, 'GET', '/meetings/rooms/'.self::FRESH_MEETING_CODE)->getStatusCode();
        $this->assertSame($case->outcome === Outcome::Allowed ? 200 : 404, $status, $case->key().': reservation state after create.');
    }

    private function runMeetingShow(OwnershipCase $case): void
    {
        $reservation = $this->seedReservation($case->scope, $case->actor === Actor::Admin ? Actor::Admin : Actor::Member);
        $response = $this->requestAs($case->actor, 'GET', '/meetings/rooms/'.$reservation['code']);
        $this->assertRestOutcome($response, $case);
        $this->assertTrue((bool) $response->json('reserved'), $case->key());

        $manages = in_array($case->actor, Actor::signedIn(), true) && in_array($case->scope, [Scope::OwnUser, Scope::OwnGroup], true);
        foreach (['ownerPrincipal', 'createdBy', 'expiresAt'] as $field) {
            $present = array_key_exists($field, (array) $response->json());
            $this->assertSame($manages, $present, $case->key().': owner field '.$field.' visibility.');
        }
    }

    private function runMeetingPatch(OwnershipCase $case): void
    {
        $reservation = $this->seedReservation($case->scope, $case->actor === Actor::Admin ? Actor::Admin : Actor::Member);
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/meetings/rooms/'.$reservation['code'], ['expiresAt' => null]);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $this->assertNull($this->reservationSnapshot($reservation)['expiresAt'], $case->key().': expiry not cleared.');

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->reservationSnapshot($reservation), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    // ---- RTC rooms ----------------------------------------------------------------

    /**
     * @return 'meet'|'collab'|'principal'
     */
    private function roomKind(OwnershipCase $case): string
    {
        $kind = explode('-', (string) $case->variant, 2)[0];

        return match ($kind) {
            'meet', 'collab', 'principal' => $kind,
            default => throw new LogicException('No room kind in '.$case->key()),
        };
    }

    /**
     * The username that owns the room's target in this scope.
     */
    private function roomOwner(OwnershipCase $case): string
    {
        $actor = $case->actor === Actor::Admin ? Actor::Admin : Actor::Member;

        return match ($case->scope) {
            Scope::OwnUser => $this->usernameFor($actor),
            Scope::OwnGroup => OwnershipPrincipals::DAVE,
            Scope::FormerGroup => $this->otherActorUsername($actor),
            default => OwnershipPrincipals::CAROL,
        };
    }

    /**
     * Signaling room id and its storage key for the scope.
     *
     * @return array{roomId: string, store: string}
     */
    private function roomFor(OwnershipCase $case): array
    {
        $kind = $this->roomKind($case);
        $actorName = $this->usernameFor($case->actor === Actor::Admin ? Actor::Admin : Actor::Member);

        if ($kind === 'meet') {
            $code = $case->scope === Scope::OwnUser ? self::OWN_MEETING_CODE : self::OTHER_MEETING_CODE;

            return ['roomId' => $code, 'store' => $code];
        }

        if ($kind === 'principal') {
            $room = match ($case->scope) {
                Scope::OwnGroup => 'groups.'.OwnershipPrincipals::CREW,
                Scope::OtherGroup => $case->variant === 'principal-unknown-group' ? 'groups.no-such-group' : 'groups.'.OwnershipPrincipals::OUTSIDERS,
                Scope::FormerGroup => 'groups.'.OwnershipPrincipals::ALUMNI,
                // other-user: dave's participant in a room the actor shares with him.
                // none (guest, anonymous): a real Team room, refused before any lookup.
                default => 'groups.'.OwnershipPrincipals::CREW,
            };

            return ['roomId' => app(RoomIdCodec::class)->encodePrincipalRoom($room), 'store' => $room];
        }

        $root = match ($case->scope) {
            Scope::OwnUser => '/users/'.$actorName,
            Scope::OwnGroup => '/groups/'.OwnershipPrincipals::CREW,
            Scope::OtherGroup => '/groups/'.OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => '/groups/'.OwnershipPrincipals::ALUMNI,
            default => '/users/'.OwnershipPrincipals::CAROL,
        };
        $name = $case->variant === 'collab-unknown-target' ? 'missing.md' : self::DOC_NAME;
        $path = $root.'/'.$name;

        return [
            'roomId' => app(RoomIdCodec::class)->encodeFilePath($path),
            'store' => app(CollabRoomPolicy::class)->roomKey(RoomIdCodec::canonicalFilePath($path)),
        ];
    }

    /**
     * Seeds what the room needs before the actor acts: the meeting
     * reservation or the drive document, created by its owner.
     */
    private function seedRoomTarget(OwnershipCase $case): void
    {
        $kind = $this->roomKind($case);
        if ($kind === 'meet') {
            $owner = $case->scope === Scope::OwnUser ? $this->usernameFor($case->actor) : OwnershipPrincipals::CAROL;
            $code = $case->scope === Scope::OwnUser ? self::OWN_MEETING_CODE : self::OTHER_MEETING_CODE;
            $this->requestAsUsername($owner, 'POST', '/meetings/rooms', ['room' => $code, 'ownerPrincipal' => 'u:'.$owner])->assertCreated();

            return;
        }
        if ($kind === 'collab' && $case->variant !== 'collab-unknown-target') {
            $this->createDocument($case);
        }
    }

    /**
     * A drive disk with every fixture home and group drive.
     */
    private function ensureDriveDataDir(): void
    {
        if ($this->driveDataDir !== '') {
            return;
        }
        $this->driveDataDir = storage_path('framework/testing/wgw-ownership-'.uniqid('', true));
        foreach (['users/member', 'users/admin', 'users/carol', 'users/dave', 'groups/crew', 'groups/outsiders', 'groups/alumni'] as $dir) {
            File::ensureDirectoryExists($this->driveDataDir.'/files/'.$dir);
        }
        WgwTestDisks::refresh($this->driveDataDir);
    }

    private function createDocument(OwnershipCase $case): void
    {
        $this->ensureDriveDataDir();

        $owner = $this->roomOwner($case);
        $parent = match ($case->scope) {
            Scope::OwnUser, Scope::OtherUser => '/users/'.$owner,
            Scope::OwnGroup => '/groups/'.OwnershipPrincipals::CREW,
            Scope::OtherGroup => '/groups/'.OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => '/groups/'.OwnershipPrincipals::ALUMNI,
            default => '/users/'.OwnershipPrincipals::CAROL,
        };
        $result = app(DriveService::class)->createItem(['username' => $owner, 'role' => 'user'], self::DOC_NAME, 'file', $parent);
        $this->assertSame('Created', $result);
    }

    /**
     * Joins a room as a fixture principal and returns the participant id.
     *
     * @param  array{roomId: string, store: string}  $room
     */
    private function joinAsUsername(string $username, string $kind, array $room, string $meetPeerId): string
    {
        $body = $kind === 'meet' ? ['peerId' => $meetPeerId, 'name' => ucfirst($username)] : ['name' => ucfirst($username)];
        $response = $this->requestAsUsername($username, 'POST', '/rooms/'.$room['roomId'].'/participants', $body)->assertOk();

        return $kind === 'meet' ? $meetPeerId : (string) $response->json('peerId');
    }

    private function runJoin(OwnershipCase $case): void
    {
        $kind = $this->roomKind($case);
        $this->seedRoomTarget($case);
        if ($kind === 'meet' && $case->scope === Scope::OtherUser) {
            $this->joinAsUsername(OwnershipPrincipals::CAROL, $kind, $this->roomFor($case), self::CAROL_MEET_PEER);
        }
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $room = $this->roomFor($case);
        $body = $kind === 'meet' ? ['peerId' => self::ACTOR_MEET_PEER, 'name' => 'Actor'] : ['name' => 'Actor'];
        $send = fn (array $target): TestResponse => $this->requestAs($case->actor, 'POST', '/rooms/'.$target['roomId'].'/participants', $body);

        if ($case->outcome === Outcome::Allowed) {
            $response = $send($room);
            $this->assertRestOutcome($response, $case);
            if ($kind !== 'meet') {
                $this->assertIsString($response->json('peerId'), $case->key());
            }

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->roomSnapshot($kind, $room['store'], true), fn () => $send($room), $case->key());
        $this->assertRestOutcome($response, $case);

        if ($case->variant === 'collab-unknown-target' || $case->variant === 'principal-unknown-group') {
            $existing = $this->existingVariantOf($case);
            $this->assertIdenticalAnswer($response, $send($existing), $case);
        }
    }

    /**
     * The same room with the real target, for the identical-answer check.
     *
     * @return array{roomId: string, store: string}
     */
    private function existingVariantOf(OwnershipCase $case): array
    {
        $kind = $this->roomKind($case);
        $real = new OwnershipCase($case->operation, $case->actor, $case->scope, $case->outcome, $case->errorCode, null, $kind);
        $this->seedRoomTarget($real);

        return $this->roomFor($real);
    }

    private function runConfiguration(OwnershipCase $case): void
    {
        $kind = $this->roomKind($case);
        if ($kind !== 'principal') {
            $this->seedRoomTarget($case);
        }
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $room = $this->roomFor($case);
        $response = $this->requestAs($case->actor, 'GET', '/rooms/'.$room['roomId'].'/configuration');
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertIsArray($response->json('rtc'), $case->key());
        }
    }

    /**
     * Poll, send, chat, relay, and leave on one participant.
     */
    private function runPeerOperation(OwnershipCase $case): void
    {
        $kind = $this->roomKind($case);
        $this->seedRoomTarget($case);
        $room = $this->roomFor($case);
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org:3478',
            SettingKeys::RTC_TURN_SECRET => 'ownership',
        ]);

        $actsOnOwnPeer = in_array($case->scope, [Scope::OwnUser, Scope::OwnGroup, Scope::FormerGroup], true);
        if ($actsOnOwnPeer) {
            $peerId = $this->joinAsUsername($this->usernameFor($case->actor), $kind, $room, self::ACTOR_MEET_PEER);
            if ($case->scope === Scope::FormerGroup) {
                $this->leaveFormerGroup($case->actor);
            }
        } else {
            $peerId = $this->joinAsUsername($this->peerTargetUser($case), $kind, $room, self::CAROL_MEET_PEER);
            $this->requestAsUsername($this->peerTargetUser($case), 'POST', '/rooms/'.$room['roomId'].'/events', [
                $kind === 'meet' ? 'from' : 'peerId' => $peerId,
                'to' => $peerId,
                'type' => 'offer',
                'payload' => ['sdp' => self::ROOM_EVENT_MARKER],
            ])->assertSuccessful();
            $actorInRoom = $kind === 'meet' || ($kind === 'principal' && $case->scope === Scope::OtherUser);
            if ($actorInRoom && in_array($case->actor, Actor::signedIn(), true)) {
                $this->joinAsUsername($this->usernameFor($case->actor), $kind, $room, self::ACTOR_MEET_PEER);
            }
        }

        $send = fn (string $peer): TestResponse => $this->sendPeerOperation($case, $kind, $room['roomId'], $peer);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send($peerId), $case);

            return;
        }

        // A participant that lost access may be evicted on its next request,
        // so former-group snapshots leave the roster out.
        $withPeers = $case->scope !== Scope::FormerGroup;
        $response = $this->assertUnchanged(
            fn () => $this->roomSnapshot($kind, $room['store'], $withPeers),
            fn () => $send($peerId),
            $case->key(),
        );
        $this->assertNoRoomContent($response, $case);
        $this->assertRestOutcome($response, $case);

        $actorCannotJoin = $kind === 'collab' || ($kind === 'principal' && $case->scope === Scope::OtherGroup);
        if ($actorCannotJoin && $case->outcome === Outcome::Forbidden && ! $actsOnOwnPeer) {
            $unknown = $kind === 'collab' ? self::UNKNOWN_COLLAB_PEER : self::UNKNOWN_PRINCIPAL_PEER;
            $unknownResponse = $send($unknown);
            $this->assertNoRoomContent($unknownResponse, $case);
            $this->assertCaseOutcome($case, function (OwnershipCase $expected) use ($case, $response, $unknownResponse): void {
                if ($expected === $case) {
                    $this->assertIdenticalAnswer($response, $unknownResponse, $case);

                    return;
                }
                $this->assertRestOutcome($unknownResponse, new OwnershipCase($case->operation, $case->actor, $case->scope, $expected->outcome, $expected->errorCode, variant: 'unknown-peer'));
            });
        }
    }

    /**
     * A refused peer operation carries nothing of the room: no roster entry,
     * event, message or relay credential.
     */
    private function assertNoRoomContent(TestResponse $response, OwnershipCase $case): void
    {
        $content = (string) $response->getContent();
        foreach ([self::ROOM_EVENT_MARKER, ucfirst($this->peerTargetUser($case)), 'relay.example.org', 'credential', '"participants"', '"events"', '"messages"'] as $needle) {
            $this->assertStringNotContainsString($needle, $content, $case->key().': room content in the response.');
        }
    }

    /**
     * The other user whose participant a peer operation targets: dave in a presence
     * room the actor shares with him, carol everywhere else.
     */
    private function peerTargetUser(OwnershipCase $case): string
    {
        $principalRoom = str_starts_with((string) $case->variant, 'principal') && $case->scope === Scope::OtherUser;

        return $principalRoom ? OwnershipPrincipals::DAVE : OwnershipPrincipals::CAROL;
    }

    private function sendPeerOperation(OwnershipCase $case, string $kind, string $roomId, string $peerId): TestResponse
    {
        $base = '/rooms/'.$roomId;
        $fromField = $kind === 'meet' ? 'from' : 'peerId';

        return match ($case->operation) {
            self::POLL => $this->requestAs($case->actor, 'GET', $base.'/events?peerId='.urlencode($peerId).'&since=0'),
            self::SEND => $this->requestAs($case->actor, 'POST', $base.'/events', [
                $fromField => $peerId,
                'to' => $peerId,
                'type' => 'offer',
                'payload' => ['sdp' => 'v=0'],
            ]),
            self::CHAT => $this->requestAs($case->actor, 'POST', $base.'/messages', ['from' => $peerId, 'text' => 'hello']),
            self::RELAY => $this->requestAs($case->actor, 'POST', $base.'/relay', ['peerId' => $peerId, 'reason' => 'precheck', 'target' => '*']),
            self::LEAVE => $this->requestAs($case->actor, 'DELETE', $base.'/participants/'.$peerId),
            default => throw new LogicException('No peer operation '.$case->operation),
        };
    }

    /**
     * Signaling rows of one room. There is no read endpoint that leaves the
     * mailbox untouched, so the rows are the owner's view.
     *
     * @return array<string, mixed>
     */
    private function roomSnapshot(string $kind, string $store, bool $withPeers): array
    {
        $models = match ($kind) {
            'meet' => [MeetPeer::class, MeetMessage::class],
            'collab' => [CollabPeer::class, CollabMessage::class],
            default => [PrincipalPeer::class, PrincipalMessage::class],
        };
        [$peerModel, $messageModel] = $models;

        $snapshot = [
            'messages' => $messageModel::query()->where('room', $store)->count(),
            'relayIssued' => RtcRelayEvent::query()->where('outcome', RtcRelayService::OUTCOME_ISSUED)->count(),
        ];
        if ($withPeers) {
            $peers = $peerModel::query()->where('room', $store)->pluck('peer_id')->map(strval(...))->all();
            sort($peers);
            $snapshot['peers'] = $peers;
        }

        return $snapshot;
    }

    /**
     * Carol owns the room and is in it. The caller knocks, then acts with the
     * participant id it knocked with.
     */
    private function runClosedRoom(OwnershipCase $case): void
    {
        $carol = OwnershipPrincipals::CAROL;
        $roomId = match ($case->variant) {
            'meet-channel' => (string) $this->requestAsUsername($carol, 'POST', '/chat/channels', ['name' => 'Team', 'kind' => 'channel'])->assertCreated()->json('id'),
            'meet-dm' => (string) $this->requestAsUsername($carol, 'POST', '/chat/dms', ['principal' => OwnershipPrincipals::DAVE])->assertOk()->json('id'),
            default => (string) $this->requestAsUsername($carol, 'POST', '/chat/channels', ['name' => 'Planning', 'kind' => 'meeting'])->assertCreated()->json('id'),
        };
        $this->joinAsUsername($carol, 'meet', ['roomId' => $roomId, 'store' => $roomId], self::CAROL_MEET_PEER);
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org:3478',
            SettingKeys::RTC_TURN_SECRET => 'ownership',
        ]);

        $base = '/rooms/'.$roomId;
        $knock = fn (): TestResponse => $this->requestAs($case->actor, 'POST', $base.'/participants', [
            'peerId' => self::GUEST_PEER,
            'name' => self::KNOCK_PREFIX.'Visitor',
        ]);
        if ($case->operation === self::JOIN) {
            $response = $this->assertUnchanged(fn () => $this->roomSnapshot('meet', $roomId, true), $knock, $case->key());
            $this->assertRestOutcome($response, $case);
            $plain = $this->requestAs($case->actor, 'POST', $base.'/participants', ['peerId' => self::GUEST_PEER, 'name' => 'Visitor']);
            $this->assertSame(403, $plain->getStatusCode(), $case->key().': plain join.');

            return;
        }

        $knock();
        $send = match ($case->operation) {
            self::POLL => fn (): TestResponse => $this->requestAs($case->actor, 'GET', $base.'/events?peerId='.self::GUEST_PEER.'&since=0'),
            self::CHAT => fn (): TestResponse => $this->requestAs($case->actor, 'POST', $base.'/messages', [
                'from' => self::GUEST_PEER,
                'text' => self::CONTROL_PREFIX.json_encode(['kind' => 'knock', 'peerId' => self::GUEST_PEER, 'name' => 'Visitor']),
            ]),
            default => fn (): TestResponse => $this->requestAs($case->actor, 'POST', $base.'/relay', ['peerId' => self::GUEST_PEER, 'reason' => 'precheck', 'target' => '*']),
        };
        $response = $this->assertUnchanged(fn () => $this->roomSnapshot('meet', $roomId, false), $send, $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertStringNotContainsString($carol, (string) $response->getContent(), $case->key().': roster leaked.');
    }

    private function assertIdenticalAnswer(TestResponse $existing, TestResponse $unknown, OwnershipCase $case): void
    {
        $this->assertSame($existing->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown targets differ.');
        $this->assertSame($existing->json(), $unknown->json(), $case->key().': existing and unknown targets differ.');
    }
}
