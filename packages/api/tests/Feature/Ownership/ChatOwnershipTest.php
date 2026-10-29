<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\CalendarInstance;
use App\Models\ChatReadMarker;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipPrincipals;
use Tests\Support\Ownership\OwnershipRegistry;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Ownership matrix for chat channels and messages, REST and JMAP (plan
 * chunk-e-chat).
 *
 * Each case seeds one channel holding one message, owned and shared as the
 * scope describes. Channel ids are the same for the owner and every sharee,
 * so every scope addresses the owner's id. `other-user` is a DM between carol
 * and dave. The message in the target channel is written by the channel's
 * owner side (the actor for `own-user`, dave for `own-group`, carol
 * elsewhere), so message edit and delete rows test the author-only rule.
 *
 * Grant scopes apply: channels are shared through `shareWith` with read or
 * write rights, to a user or to a group.
 */
final class ChatOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    /** Operations that need only read access to the target channel. */
    private const READ_OPS = [
        'GET /chat/channels',
        'GET /chat/channels/changes',
        'GET /chat/channels/{channelId}',
        'GET /chat/channels/{channelId}/messages',
        'GET /chat/messages/changes',
        'PUT /chat/channels/{channelId}/read-marker',
        'JMAP ChatChannel/get',
        'JMAP ChatChannel/changes',
        'JMAP ChatMessage/get',
        'JMAP ChatMessage/changes',
        'JMAP ChatMessage/query',
    ];

    /** Message writes open to every member with write access. */
    private const ITEM_WRITE_OPS = [
        'POST /chat/channels/{channelId}/messages',
        'POST /chat/messages/{messageId}/reactions',
    ];

    /** Message writes open to the message author only. */
    private const AUTHOR_OPS = [
        'PATCH /chat/messages/{messageId}',
        'DELETE /chat/messages/{messageId}',
    ];

    private const JMAP_OPS = [
        'JMAP ChatChannel/get',
        'JMAP ChatChannel/changes',
        'JMAP ChatMessage/get',
        'JMAP ChatMessage/changes',
        'JMAP ChatMessage/query',
        'JMAP ChatMessage/queryChanges',
    ];

    private const REST_OPS = [
        'DELETE /chat/channels/{channelId}',
        'DELETE /chat/messages/{messageId}',
        'GET /chat/channels',
        'GET /chat/channels/changes',
        'GET /chat/channels/{channelId}',
        'GET /chat/channels/{channelId}/messages',
        'GET /chat/messages/changes',
        'PATCH /chat/channels/{channelId}',
        'PATCH /chat/messages/{messageId}',
        'POST /chat/channels',
        'POST /chat/channels/{channelId}/messages',
        'POST /chat/dms',
        'POST /chat/messages/{messageId}/reactions',
        'PUT /chat/channels/{channelId}/read-marker',
    ];

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
     * Write scopes where the actor is not the target message's author; they
     * also get an `author` variant on a message the actor wrote itself.
     */
    private const AUTHOR_VARIANT = [Scope::OwnGroup, Scope::UserToActorWrite];

    /**
     * Admin rows, per scope: where an admin right could apply (group delete,
     * author-only writes, sharing) and where another user's DM must stay
     * closed. The rest is the member's code path.
     */
    private const ADMIN_ROWS = [
        'own-group' => [
            'DELETE /chat/channels/{channelId}',
            'PATCH /chat/channels/{channelId} | rename',
            'PATCH /chat/channels/{channelId} | reshare',
            'PATCH /chat/messages/{messageId}',
            'PATCH /chat/messages/{messageId} | author',
            'DELETE /chat/messages/{messageId}',
            'DELETE /chat/messages/{messageId} | author',
            'POST /chat/messages/{messageId}/reactions',
        ],
        'other-user' => [
            'GET /chat/channels/{channelId}',
            'GET /chat/channels/{channelId}/messages',
            'GET /chat/messages/changes',
            'PUT /chat/channels/{channelId}/read-marker',
            'POST /chat/channels/{channelId}/messages',
            'POST /chat/messages/{messageId}/reactions',
            'PATCH /chat/messages/{messageId}',
            'DELETE /chat/messages/{messageId}',
            'PATCH /chat/channels/{channelId} | rename',
            'DELETE /chat/channels/{channelId}',
            'JMAP ChatChannel/get',
            'JMAP ChatChannel/changes',
            'JMAP ChatMessage/get',
            'JMAP ChatMessage/changes',
            'JMAP ChatMessage/query',
            'JMAP ChatChannel/get | foreign-account',
            'JMAP ChatChannel/changes | foreign-account',
            'JMAP ChatMessage/get | foreign-account',
            'JMAP ChatMessage/changes | foreign-account',
            'JMAP ChatMessage/query | foreign-account',
        ],
    ];

    private const EMOJI = "\u{1F44D}";

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
    }

    public static function ownershipCases(): array
    {
        $cases = [];

        foreach (Actor::signedIn() as $actor) {
            foreach (self::scopesFor($actor) as $scope) {
                foreach (self::scopeCases($actor, $scope) as $case) {
                    if (self::declaredFor($case)) {
                        $cases[] = $case;
                    }
                }
            }
            array_push($cases, ...self::extraCases($actor));
        }

        foreach (self::REST_OPS as $op) {
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

    // ---- Declarations ----------------------------------------------------

    /**
     * The member runs every scope. The admin has no per-object bypass and
     * differs from the member only inside its own group (collection delete),
     * so it runs `own-group`, plus `other-user` (another user's DM) to prove
     * the absence of a bypass; see ADMIN_ROWS.
     *
     * @return list<Scope>
     */
    private static function scopesFor(Actor $actor): array
    {
        if ($actor === Actor::Admin) {
            return [Scope::OwnGroup, Scope::OtherUser];
        }

        return array_merge([Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup], [
            Scope::UserToActorRead, Scope::UserToActorWrite,
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup, Scope::GrantRevoked, Scope::GrantDismissed,
        ]);
    }

    private static function declaredFor(OwnershipCase $case): bool
    {
        if ($case->actor !== Actor::Admin) {
            return true;
        }
        $row = $case->variant === null ? $case->operation : $case->operation.' | '.$case->variant;

        return in_array($row, self::ADMIN_ROWS[$case->scope->value] ?? [], true);
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function scopeCases(Actor $actor, Scope $scope): array
    {
        $cases = [];
        $visible = in_array($scope, self::VISIBLE, true);
        $readOnly = in_array($scope, self::READ_ONLY, true);
        $sharee = in_array($scope, self::SHAREE, true);

        foreach (self::READ_OPS as $op) {
            $cases[] = OwnershipCase::of($op, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound);
        }

        $write = ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed);
        foreach (self::ITEM_WRITE_OPS as $op) {
            $cases[] = OwnershipCase::of($op, $actor, $scope, $write);
        }

        // Author-only: the target message is the owner side's, so every
        // visible scope but own-user is a non-author write.
        $authorWrite = $scope === Scope::OwnUser ? Outcome::Allowed : ($visible ? Outcome::Forbidden : Outcome::NotFound);
        foreach (self::AUTHOR_OPS as $op) {
            $cases[] = OwnershipCase::of($op, $actor, $scope, $authorWrite);
            if (in_array($scope, self::AUTHOR_VARIANT, true)) {
                $cases[] = OwnershipCase::of($op, $actor, $scope, Outcome::Allowed)->variant('author');
            }
        }

        $patch = 'PATCH /chat/channels/{channelId}';
        $cases[] = OwnershipCase::of($patch, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound)->variant('rename');
        // rename already proves the invisible scopes; other-user keeps one.
        if ($visible || $scope === Scope::OtherUser) {
            $cases[] = OwnershipCase::of($patch, $actor, $scope, ! $visible ? Outcome::NotFound : ($sharee ? Outcome::Forbidden : Outcome::Allowed))
                ->variant('reshare');
        }

        $cases[] = self::channelDeleteCase($actor, $scope, $visible, $sharee);

        if ($scope === Scope::OtherUser) {
            foreach (self::JMAP_OPS as $op) {
                $cases[] = OwnershipCase::of($op, $actor, $scope, Outcome::AccountNotFound)->variant('foreign-account');
            }
        }

        return $cases;
    }

    /**
     * Body-addressed targets and fixed collections.
     *
     * @return list<OwnershipCase>
     */
    private static function extraCases(Actor $actor): array
    {
        $create = 'POST /chat/channels';
        $patch = 'PATCH /chat/channels/{channelId}';
        $delete = 'DELETE /chat/channels/{channelId}';
        $dms = 'POST /chat/dms';

        $cases = [
            OwnershipCase::of($create, $actor, Scope::OwnUser, Outcome::Allowed),
            OwnershipCase::of($create, $actor, Scope::OwnGroup, Outcome::Allowed),
            // The membership check answers 403 for every slug the caller is
            // not in, existing or not, so it reveals nothing (see unknown-group).
            OwnershipCase::of($create, $actor, Scope::OtherGroup, Outcome::Forbidden),
            OwnershipCase::of($create, $actor, Scope::FormerGroup, Outcome::Forbidden),
            OwnershipCase::of($create, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('unknown-group'),
            // A client-chosen id that a channel the actor cannot see already
            // uses: the create answers as for an unused id, under a fresh id.
            OwnershipCase::of($create, $actor, Scope::OtherUser, Outcome::Allowed)->variant('client-id'),
            OwnershipCase::of($create, $actor, Scope::OtherGroup, Outcome::Allowed)->variant('client-id'),
            OwnershipCase::of($create, $actor, Scope::FormerGroup, Outcome::Allowed)->variant('client-id'),
            // A group default channel id is never a valid client id.
            OwnershipCase::of($create, $actor, Scope::OtherGroup, Outcome::Rejected)->variant('client-id-group-default')
                ->declared(Outcome::Rejected, 'invalidProperties'),
            // A name whose slug matches a channel the actor cannot see.
            OwnershipCase::of($create, $actor, Scope::OtherUser, Outcome::Allowed)->variant('name-slug'),
            // A client-chosen message id that a message the actor cannot see
            // already uses: the post lands in the actor's channel under a fresh id.
            OwnershipCase::of('POST /chat/channels/{channelId}/messages', $actor, Scope::OtherUser, Outcome::Allowed)->variant('client-id'),

            // Fixed collections: a DM and the provisioned group default channel.
            OwnershipCase::of($patch, $actor, Scope::OwnUser, Outcome::Forbidden)->variant('dm'),
            OwnershipCase::of($delete, $actor, Scope::OwnUser, Outcome::Forbidden)->variant('dm'),
            OwnershipCase::of($patch, $actor, Scope::OwnGroup, Outcome::Forbidden)->variant('group-default'),
            OwnershipCase::of($delete, $actor, Scope::OwnGroup, Outcome::Forbidden)->variant('group-default'),

            // groupSlug on PATCH moves the actor's own channel to another owner.
            OwnershipCase::of($patch, $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('transfer'),
            OwnershipCase::of($patch, $actor, Scope::FormerGroup, Outcome::Forbidden)->variant('transfer'),

            // The channel owner is not the author of a member's message.
            OwnershipCase::of('PATCH /chat/messages/{messageId}', $actor, Scope::OwnUser, Outcome::Forbidden)->variant('channel-owner'),
            OwnershipCase::of('DELETE /chat/messages/{messageId}', $actor, Scope::OwnUser, Outcome::Forbidden)->variant('channel-owner'),

            // ChatMessage/queryChanges has no per-object answer: it refuses every query the same way.
            OwnershipCase::of('JMAP ChatMessage/queryChanges', $actor, Scope::OtherUser, Outcome::NotFound)->variant('cannot-calculate'),

            // /chat/dms principal: another user, the actor itself, a group, and nobody.
            OwnershipCase::of($dms, $actor, Scope::OtherUser, Outcome::Allowed),
            OwnershipCase::of($dms, $actor, Scope::OwnUser, Outcome::Rejected)->withCode('invalidProperties')->variant('self'),
            OwnershipCase::of($dms, $actor, Scope::OtherGroup, Outcome::Rejected)->withCode('invalidProperties')->variant('group-uri'),
            OwnershipCase::of($dms, $actor, Scope::OtherGroup, Outcome::Rejected)->withCode('invalidProperties')->variant('group-slug'),
            OwnershipCase::of($dms, $actor, Scope::OtherUser, Outcome::Rejected)->withCode('invalidProperties')->variant('unknown-principal'),
        ];

        if ($actor === Actor::Member) {
            return $cases;
        }

        // The admin keeps the rows where an admin right could apply: group
        // membership on create and the provisioned group default.
        $adminKeys = [
            $create.' | admin | other-group',
            $create.' | admin | other-group | unknown-group',
            $patch.' | admin | own-group | group-default',
            $delete.' | admin | own-group | group-default',
        ];

        return array_values(array_filter($cases, static fn (OwnershipCase $case): bool => in_array($case->key(), $adminKeys, true)));
    }

    private static function channelDeleteCase(Actor $actor, Scope $scope, bool $visible, bool $sharee): OwnershipCase
    {
        $op = 'DELETE /chat/channels/{channelId}';
        if (! $visible) {
            return OwnershipCase::of($op, $actor, $scope, Outcome::NotFound);
        }
        if ($sharee) {
            return OwnershipCase::of($op, $actor, $scope, Outcome::Dismissed);
        }
        if ($scope === Scope::OwnGroup && $actor === Actor::Member) {
            return OwnershipCase::of($op, $actor, $scope, Outcome::Forbidden)->withCode('group_delete_admin_only');
        }

        return OwnershipCase::of($op, $actor, $scope, Outcome::Allowed);
    }

    // ---- Dispatch --------------------------------------------------------

    private function runCase(OwnershipCase $case): void
    {
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->runAnonymous($case);

            return;
        }

        match (true) {
            $case->operation === 'POST /chat/channels' => $this->runCreateChannel($case),
            $case->operation === 'POST /chat/dms' => $this->runOpenDm($case),
            in_array($case->variant, ['dm', 'group-default', 'transfer'], true) => $this->runFixedChannel($case),
            $case->variant === 'channel-owner' => $this->runChannelOwnerWrite($case),
            default => $this->runTargetCase($case),
        };
    }

    private function runTargetCase(OwnershipCase $case): void
    {
        $target = $this->seedTarget($case->scope, $case->actor);

        match ($case->operation) {
            'GET /chat/channels' => $this->runChannelIndex($case, $target),
            'GET /chat/channels/changes' => $this->runChannelChanges($case, $target),
            'GET /chat/channels/{channelId}' => $this->runChannelShow($case, $target),
            'PATCH /chat/channels/{channelId}' => $this->runChannelPatch($case, $target),
            'DELETE /chat/channels/{channelId}' => $this->runChannelDelete($case, $target),
            'GET /chat/channels/{channelId}/messages' => $this->runMessageIndex($case, $target),
            'GET /chat/messages/changes' => $this->runMessageChanges($case, $target),
            'PUT /chat/channels/{channelId}/read-marker' => $this->runReadMarker($case, $target),
            'POST /chat/channels/{channelId}/messages' => $this->runMessageCreate($case, $target),
            'POST /chat/messages/{messageId}/reactions' => $this->runReaction($case, $target),
            'PATCH /chat/messages/{messageId}', 'DELETE /chat/messages/{messageId}' => $this->runAuthorWrite($case, $target),
            OwnershipRegistry::jmapKey('ChatChannel/get') => $this->runJmapChannelGet($case, $target),
            OwnershipRegistry::jmapKey('ChatChannel/changes') => $this->runJmapChannelChanges($case, $target),
            OwnershipRegistry::jmapKey('ChatMessage/get') => $this->runJmapMessageGet($case, $target),
            OwnershipRegistry::jmapKey('ChatMessage/changes') => $this->runJmapMessageChanges($case, $target),
            OwnershipRegistry::jmapKey('ChatMessage/query') => $this->runJmapMessageQuery($case, $target),
            OwnershipRegistry::jmapKey('ChatMessage/queryChanges') => $this->runJmapMessageQueryChanges($case, $target),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    // ---- Target seeding -------------------------------------------------

    /**
     * @return array{owner: string, channelId: string, messageId: string}
     */
    private function seedTarget(Scope $scope, Actor $actor): array
    {
        $carol = OwnershipPrincipals::CAROL;
        $self = $this->usernameFor($actor);
        // The other actor stays in alumni, so the owner's view still works
        // after this actor leaves.
        $otherActor = $this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin);
        $name = 'chan '.$scope->value;

        if ($scope === Scope::OtherUser) {
            $channelId = $this->openDm($carol, OwnershipPrincipals::DAVE);

            return ['owner' => $carol, 'channelId' => $channelId, 'messageId' => $this->postMessage($carol, $channelId, 'dm '.$scope->value)];
        }

        [$owner, $groupSlug] = match ($scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, OwnershipPrincipals::OUTSIDERS],
            Scope::FormerGroup => [$otherActor, OwnershipPrincipals::ALUMNI],
            default => [$carol, null],
        };

        $channelId = $this->createChannel($owner, $name, $groupSlug);
        $messageId = $this->postMessage($owner, $channelId, 'message '.$scope->value);

        switch ($scope) {
            case Scope::UserToActorRead:
            case Scope::GroupToNonmemberRead:
                $this->share($owner, $channelId, $self, write: false);
                break;
            case Scope::UserToActorWrite:
            case Scope::GroupToNonmemberWrite:
                $this->share($owner, $channelId, $self, write: true);
                break;
            case Scope::UserToActorGroup:
                $this->share($owner, $channelId, 'groups/'.OwnershipPrincipals::CREW, write: true);
                break;
            case Scope::GrantRevoked:
                $this->share($owner, $channelId, $self, write: true);
                $this->requestAs($actor, 'GET', '/chat/channels/'.$channelId)->assertOk();
                $this->requestAsUsername($owner, 'PATCH', '/chat/channels/'.$channelId, ['shareWith' => [$self => null]])->assertOk();
                break;
            case Scope::GrantDismissed:
                $this->share($owner, $channelId, $self, write: true);
                $this->requestAs($actor, 'DELETE', '/chat/channels/'.$channelId)->assertOk();
                break;
            case Scope::FormerGroup:
                $this->requestAs($actor, 'GET', '/chat/channels/'.$channelId)->assertOk();
                $this->leaveFormerGroup($actor);
                break;
            default:
                break;
        }

        return ['owner' => $owner, 'channelId' => $channelId, 'messageId' => $messageId];
    }

    private function createChannel(string $owner, string $name, ?string $groupSlug, ?string $id = null): string
    {
        $payload = ['name' => $name, 'kind' => 'channel'];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }
        if ($id !== null) {
            $payload['id'] = $id;
        }

        return (string) $this->requestAsUsername($owner, 'POST', '/chat/channels', $payload)->assertCreated()->json('id');
    }

    private function openDm(string $username, string $peer): string
    {
        return (string) $this->requestAsUsername($username, 'POST', '/chat/dms', ['principal' => $peer])->assertOk()->json('id');
    }

    private function postMessage(string $username, string $channelId, string $body): string
    {
        $id = (string) Str::ulid();
        $this->requestAsUsername($username, 'POST', '/chat/channels/'.$channelId.'/messages', ['id' => $id, 'body' => $body])
            ->assertCreated();

        return $id;
    }

    private function share(string $owner, string $channelId, string $grantee, bool $write): void
    {
        $rights = $write ? ['mayWriteAll' => true] : ['mayReadItems' => true];
        $this->requestAsUsername($owner, 'PATCH', '/chat/channels/'.$channelId, ['shareWith' => [$grantee => $rights]])->assertOk();
    }

    /**
     * The owner's view of the target, for proving a denied write changed nothing.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target): array
    {
        $channel = $this->requestAsUsername($target['owner'], 'GET', '/chat/channels/'.$target['channelId']);
        $messages = $this->requestAsUsername($target['owner'], 'GET', '/chat/channels/'.$target['channelId'].'/messages');

        return [
            'channelStatus' => $channel->getStatusCode(),
            'name' => $channel->json('name'),
            'topic' => $channel->json('topic'),
            'groupSlug' => $channel->json('groupSlug'),
            'shareWith' => $channel->json('shareWith'),
            'messages' => array_map(static fn (array $message): array => [
                $message['id'] ?? null,
                $message['body'] ?? null,
                $message['editedAt'] ?? null,
                $message['deletedAt'] ?? null,
                $message['reactions'] ?? null,
            ], $this->rows($messages)),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function rows(TestResponse $response): array
    {
        $rows = $response->json('list');

        return is_array($rows) ? array_values(array_filter($rows, 'is_array')) : [];
    }

    /**
     * @return list<string>
     */
    private function channelIdsFor(Actor $actor): array
    {
        return array_map('strval', array_column($this->rows($this->requestAs($actor, 'GET', '/chat/channels')->assertOk()), 'id'));
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function sendDenied(OwnershipCase $case, array $target, string $method, string $uri, array $data = []): TestResponse
    {
        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->requestAs($case->actor, $method, $uri, $data),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);

        return $response;
    }

    /**
     * The response carries none of the target channel's name, topic, or
     * message bodies.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function assertNoTargetContent(TestResponse $response, array $target, OwnershipCase $case): void
    {
        $snapshot = $this->ownerSnapshot($target);
        $this->assertSame(200, $snapshot['channelStatus'], $case->key().': owner lost the target channel.');
        $markers = array_merge([$snapshot['name'], $snapshot['topic']], array_column($snapshot['messages'], 1));
        $markers = array_filter($markers, static fn (mixed $marker): bool => is_string($marker) && $marker !== '');
        $this->assertNotSame([], $markers, $case->key().': target has no content to look for.');
        foreach ($markers as $marker) {
            $this->assertStringNotContainsString($marker, (string) $response->getContent(), $case->key().': target content in the response.');
        }
    }

    // ---- Channel runners -------------------------------------------------

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runChannelIndex(OwnershipCase $case, array $target): void
    {
        $ids = $this->channelIdsFor($case->actor);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['channelId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['channelId']], $ids, $case->key());
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runChannelChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/chat/channels/changes')->assertOk();
        $ids = array_map('strval', array_merge((array) $response->json('created'), (array) $response->json('updated')));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['channelId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['channelId']], $ids, $case->key());
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runChannelShow(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId']);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['channelId'], $response->json('id'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runChannelPatch(OwnershipCase $case, array $target): void
    {
        $uri = '/chat/channels/'.$target['channelId'];
        $body = $case->variant === 'reshare'
            ? ['shareWith' => [OwnershipPrincipals::DAVE => ['mayReadItems' => true]]]
            : ['name' => 'renamed by actor'];

        if ($case->outcome !== Outcome::Allowed) {
            $this->sendDenied($case, $target, 'PATCH', $uri, $body);

            return;
        }
        if ($case->variant === 'rename' && in_array($case->scope, self::SHAREE, true)) {
            // A sharee renames only its own instance; the owner's name stays.
            $response = $this->assertUnchanged(
                fn () => $this->ownerSnapshot($target),
                fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', $uri, $body),
                $case->key(),
            );
            $this->assertRestOutcome($response, $case);

            return;
        }
        $this->assertRestOutcome($this->requestAs($case->actor, 'PATCH', $uri, $body), $case);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runChannelDelete(OwnershipCase $case, array $target): void
    {
        $uri = '/chat/channels/'.$target['channelId'];
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($this->requestAs($case->actor, 'DELETE', $uri), $case);
            $this->assertSame(404, $this->ownerSnapshot($target)['channelStatus'], $case->key().': channel still exists after delete.');

            return;
        }

        // Denied and dismissed both leave the owner's channel and messages in place.
        $this->sendDenied($case, $target, 'DELETE', $uri);
        if ($case->outcome === Outcome::Dismissed) {
            $this->assertNotContains($target['channelId'], $this->channelIdsFor($case->actor), $case->key().': dismissed channel still listed.');
            $this->assertSame(404, $this->requestAs($case->actor, 'GET', $uri)->getStatusCode(), $case->key().': dismissed channel still readable.');
        }
    }

    /**
     * A DM, the provisioned group default channel, or an owner transfer of
     * the actor's own channel.
     */
    private function runFixedChannel(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        [$method] = explode(' ', $case->operation, 2);

        if ($case->variant === 'transfer') {
            $channelId = $this->createChannel($self, 'own for transfer', null);
            $slug = OwnershipPrincipals::OUTSIDERS;
            if ($case->scope === Scope::FormerGroup) {
                $slug = OwnershipPrincipals::ALUMNI;
                $this->leaveFormerGroup($case->actor);
            }
            $target = ['owner' => $self, 'channelId' => $channelId, 'messageId' => ''];
            $response = $this->assertUnchanged(
                fn () => $this->ownerSnapshot($target),
                fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/chat/channels/'.$channelId, ['groupSlug' => $slug]),
                $case->key(),
            );
            $this->assertRestOutcome($response, $case);
            $unknown = $this->requestAs($case->actor, 'PATCH', '/chat/channels/'.$channelId, ['groupSlug' => 'no-such-group']);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');

            return;
        }

        if ($case->variant === 'dm') {
            // The peer opened it, so the actor holds the sharee side.
            $owner = OwnershipPrincipals::DAVE;
            $channelId = $this->openDm($owner, $self);
        } else {
            $owner = OwnershipPrincipals::DAVE;
            $channelId = ChatCollectionUris::groupDefaultUri(OwnershipPrincipals::CREW);
            $this->assertContains($channelId, $this->channelIdsFor($case->actor), $case->key().': group default channel not provisioned.');
        }
        $target = ['owner' => $owner, 'channelId' => $channelId, 'messageId' => $this->postMessage($owner, $channelId, 'fixed')];
        $body = $method === 'PATCH' ? ['name' => 'renamed by actor', 'topic' => 'changed'] : [];

        $this->sendDenied($case, $target, $method, '/chat/channels/'.$channelId, $body);
        $this->assertContains($channelId, $this->channelIdsFor($case->actor), $case->key().': fixed channel left the actor list.');
    }

    private function runCreateChannel(OwnershipCase $case): void
    {
        if (in_array($case->variant, ['client-id', 'client-id-group-default'], true)) {
            $this->runCreateWithClientId($case);

            return;
        }
        if ($case->variant === 'name-slug') {
            $this->runCreateWithForeignName($case);

            return;
        }

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

        $payload = ['name' => 'created in '.$case->scope->value, 'kind' => 'channel'];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }
        $response = $this->requestAs($case->actor, 'POST', '/chat/channels', $payload);
        $this->assertRestOutcome($response, $case);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($groupSlug, $response->json('groupSlug'), $case->key());

            return;
        }
        if ($case->variant === 'unknown-group') {
            $unknown = $this->requestAs($case->actor, 'POST', '/chat/channels', ['groupSlug' => 'no-such-group'] + $payload);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');
        }

        $carolNames = array_column($this->rows($this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/chat/channels')), 'name');
        $this->assertNotContains($payload['name'], $carolNames, $case->key().': channel created in a group the actor is not in.');
    }

    /**
     * The actor creates a channel with a client-chosen id that already
     * belongs to a channel it cannot see (or names the not yet provisioned
     * default channel of another group). The other channel must not change,
     * the actor must not gain access to it, and the answer must not tell a
     * used id from an unused one.
     */
    private function runCreateWithClientId(OwnershipCase $case): void
    {
        if ($case->variant === 'client-id-group-default') {
            $channelId = ChatCollectionUris::groupDefaultUri(OwnershipPrincipals::OUTSIDERS);
            $response = $this->requestAs($case->actor, 'POST', '/chat/channels', [
                'name' => 'client id', 'kind' => 'channel', 'id' => $channelId,
            ]);
            $this->assertRestOutcome($response, $case);

            $carolView = $this->rows($this->requestAsUsername(OwnershipPrincipals::CAROL, 'GET', '/chat/channels')->assertOk());
            $default = array_values(array_filter($carolView, static fn (array $row): bool => ($row['id'] ?? null) === $channelId));
            $this->assertCount(1, $default, $case->key().': group default channel missing for its members.');
            $this->assertSame(OwnershipPrincipals::OUTSIDERS, $default[0]['groupSlug'] ?? null, $case->key());
            $this->assertTrue((bool) ($default[0]['isDefault'] ?? false), $case->key());

            return;
        }

        // Only `chat-` plus a ULID or UUID is a valid client id, so the target
        // channel gets one. other-user's usual target is a DM, whose id a
        // client can never choose; use one of carol's personal channels.
        $otherActor = $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin);
        [$owner, $groupSlug] = match ($case->scope) {
            Scope::OtherUser => [OwnershipPrincipals::CAROL, null],
            Scope::OtherGroup => [OwnershipPrincipals::CAROL, OwnershipPrincipals::OUTSIDERS],
            Scope::FormerGroup => [$otherActor, OwnershipPrincipals::ALUMNI],
            default => throw new LogicException('No client-id target for '.$case->scope->value),
        };
        $channelId = $this->createChannel($owner, 'client id target', $groupSlug, ChatCollectionUris::channelUri((string) Str::ulid()));
        $target = ['owner' => $owner, 'channelId' => $channelId, 'messageId' => $this->postMessage($owner, $channelId, 'target message')];
        if ($case->scope === Scope::FormerGroup) {
            $this->requestAs($case->actor, 'GET', '/chat/channels/'.$channelId)->assertOk();
            $this->leaveFormerGroup($case->actor);
        }

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/chat/channels', [
                'name' => 'client id', 'kind' => 'channel', 'id' => $target['channelId'],
            ]),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
        $this->assertNoTargetContent($response, $target, $case);
        $this->assertNotSame($target['channelId'], (string) $response->json('id'), $case->key().': actor got the other channel id.');
        $this->assertSame(404, $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId'])->getStatusCode(), $case->key());
        $this->assertSame(404, $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId'].'/messages')->getStatusCode(), $case->key());

        $fresh = $this->requestAs($case->actor, 'POST', '/chat/channels', [
            'name' => 'client id', 'kind' => 'channel', 'id' => ChatCollectionUris::channelUri((string) Str::ulid()),
        ]);
        $this->assertSame($fresh->getStatusCode(), $response->getStatusCode(), $case->key().': used and unused ids differ.');
    }

    /**
     * The actor creates a channel under the name of one of carol's channels.
     * The id it gets back is independent of channels it cannot see.
     */
    private function runCreateWithForeignName(OwnershipCase $case): void
    {
        $carolChannelId = $this->createChannel(OwnershipPrincipals::CAROL, 'Shared Name', null);
        $response = $this->requestAs($case->actor, 'POST', '/chat/channels', ['name' => 'Shared Name', 'kind' => 'channel']);
        $this->assertRestOutcome($response, $case);

        $id = (string) $response->json('id');
        $this->assertNotSame($carolChannelId, $id, $case->key());
        $this->assertStringStartsNotWith($carolChannelId.'-', $id, $case->key().': id derived from another channel.');
    }

    private function runOpenDm(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);

        if ($case->variant === null) {
            // The actor opens a DM with carol; carol's DM with dave stays
            // untouched and invisible.
            $target = $this->seedTarget(Scope::OtherUser, $case->actor);
            $response = $this->assertUnchanged(
                fn () => $this->ownerSnapshot($target),
                fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/chat/dms', ['principal' => OwnershipPrincipals::CAROL]),
                $case->key(),
            );
            $this->assertRestOutcome($response, $case);
            $this->assertNotSame($target['channelId'], $response->json('id'), $case->key());
            $this->assertSame(OwnershipPrincipals::CAROL, $response->json('dmPeer'), $case->key());
            $this->assertSame(404, $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId'])->getStatusCode(), $case->key());
            $this->assertIdsAbsent([$target['channelId']], $this->channelIdsFor($case->actor), $case->key());

            return;
        }

        $principal = match ($case->variant) {
            'self' => $self,
            'group-uri' => OwnershipPrincipals::groupUri(OwnershipPrincipals::OUTSIDERS),
            'group-slug' => OwnershipPrincipals::OUTSIDERS,
            'unknown-principal' => 'no-such-user',
            default => throw new LogicException('No DM principal for '.$case->variant),
        };
        $before = $this->channelIdsFor($case->actor);
        $response = $this->requestAs($case->actor, 'POST', '/chat/dms', ['principal' => $principal]);
        $this->assertRestOutcome($response, $case);
        $this->assertSame($before, $this->channelIdsFor($case->actor), $case->key().': a channel appeared.');

        if ($case->variant === 'group-slug') {
            $unknown = $this->requestAs($case->actor, 'POST', '/chat/dms', ['principal' => 'no-such-user']);
            $this->assertSame($response->json(), $unknown->json(), $case->key().': group and unknown principal differ.');
        }
    }

    // ---- Message runners -------------------------------------------------

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runMessageIndex(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId'].'/messages');
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['messageId'], array_column($this->rows($response), 'id'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runMessageChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/chat/messages/changes?channelId='.urlencode($target['channelId']));
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['messageId'], (array) $response->json('created'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runReadMarker(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'PUT', '/chat/channels/'.$target['channelId'].'/read-marker', [
            'lastReadTs' => gmdate('Y-m-d\TH:i:s\Z'),
            'lastReadUid' => $target['messageId'],
        ]);
        $this->assertRestOutcome($response, $case);

        $calendarId = CalendarInstance::query()->where('uri', $target['channelId'])->value('calendarid');
        $markers = ChatReadMarker::query()
            ->where('username', $this->usernameFor($case->actor))
            ->where('calendarid', (int) $calendarId)
            ->count();
        $this->assertSame($case->outcome === Outcome::Allowed ? 1 : 0, $markers, $case->key().': read marker rows.');
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runMessageCreate(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'client-id') {
            // The actor posts into its own channel, reusing the target's message id.
            $own = $this->createChannel($this->usernameFor($case->actor), 'own for client id', null);
            $response = $this->assertUnchanged(
                fn () => $this->ownerSnapshot($target),
                fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/chat/channels/'.$own.'/messages', ['id' => $target['messageId'], 'body' => 'client id']),
                $case->key(),
            );
            $this->assertRestOutcome($response, $case);
            $this->assertNoTargetContent($response, $target, $case);
            $this->assertNotSame($target['messageId'], (string) $response->json('id'), $case->key().': actor got the other message id.');
            $this->assertSame($own, (string) $response->json('channelId'), $case->key());
            $this->assertSame(404, $this->requestAs($case->actor, 'GET', '/chat/channels/'.$target['channelId'].'/messages')->getStatusCode(), $case->key());

            return;
        }
        $uri = '/chat/channels/'.$target['channelId'].'/messages';
        $body = ['id' => (string) Str::ulid(), 'body' => 'posted by actor'];
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($this->requestAs($case->actor, 'POST', $uri, $body), $case);

            return;
        }
        $this->sendDenied($case, $target, 'POST', $uri, $body);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runReaction(OwnershipCase $case, array $target): void
    {
        $uri = '/chat/messages/'.$target['messageId'].'/reactions';
        if ($case->outcome === Outcome::Allowed) {
            $response = $this->requestAs($case->actor, 'POST', $uri, ['emoji' => self::EMOJI]);
            $this->assertRestOutcome($response, $case);
            $this->assertSame([['emoji' => self::EMOJI, 'authors' => [$this->usernameFor($case->actor)]]], $response->json('reactions'), $case->key());

            return;
        }
        $this->sendDenied($case, $target, 'POST', $uri, ['emoji' => self::EMOJI]);
    }

    /**
     * PATCH and DELETE on a message. The `author` variant targets a message
     * the actor wrote itself in the scope's channel.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runAuthorWrite(OwnershipCase $case, array $target): void
    {
        [$method] = explode(' ', $case->operation, 2);
        $messageId = $case->variant === 'author'
            ? $this->postMessage($this->usernameFor($case->actor), $target['channelId'], 'own message')
            : $target['messageId'];
        $uri = '/chat/messages/'.$messageId;
        $body = $method === 'PATCH' ? ['body' => 'edited by actor'] : [];

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($this->requestAs($case->actor, $method, $uri, $body), $case);
            $row = $this->ownerMessage($target, $messageId);
            $this->assertNotNull($row[$method === 'PATCH' ? 'editedAt' : 'deletedAt'] ?? null, $case->key().': write not applied.');

            return;
        }
        $this->sendDenied($case, $target, $method, $uri, $body);
    }

    /**
     * The channel owner edits or deletes a message dave wrote in the actor's
     * own channel.
     */
    private function runChannelOwnerWrite(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $channelId = $this->createChannel($self, 'own with dave', null);
        $this->share($self, $channelId, OwnershipPrincipals::DAVE, write: true);
        $messageId = $this->postMessage(OwnershipPrincipals::DAVE, $channelId, 'by dave');
        $target = ['owner' => $self, 'channelId' => $channelId, 'messageId' => $messageId];
        [$method] = explode(' ', $case->operation, 2);

        $this->sendDenied($case, $target, $method, '/chat/messages/'.$messageId, $method === 'PATCH' ? ['body' => 'edited by owner'] : []);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     * @return array<string, mixed>|null
     */
    private function ownerMessage(array $target, string $messageId): ?array
    {
        foreach ($this->rows($this->requestAsUsername($target['owner'], 'GET', '/chat/channels/'.$target['channelId'].'/messages')) as $row) {
            if (($row['id'] ?? null) === $messageId) {
                return $row;
            }
        }

        return null;
    }

    // ---- JMAP runners ----------------------------------------------------

    /**
     * @param  array<string, mixed>  $args
     */
    private function jmapCall(OwnershipCase $case, string $method, array $args): TestResponse
    {
        $accountId = $case->outcome === Outcome::AccountNotFound ? OwnershipPrincipals::CAROL : $this->accountIdFor($case->actor);

        return $this->jmapAs($case->actor, [[$method, ['accountId' => $accountId] + $args, 'c0']], [JmapCapabilities::CORE, JmapCapabilities::CHAT]);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapChannelGet(OwnershipCase $case, array $target): void
    {
        $response = $this->jmapCall($case, 'ChatChannel/get', ['ids' => [$target['channelId']]]);
        $this->assertJmapGetOutcome($response, $target['channelId'], $case);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapChannelChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->jmapCall($case, 'ChatChannel/changes', ['sinceState' => '0:']);
        $this->assertJmapChangesOutcome($response, [$target['channelId']], $case);
    }

    /**
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapMessageGet(OwnershipCase $case, array $target): void
    {
        $response = $this->jmapCall($case, 'ChatMessage/get', ['ids' => [$target['messageId']]]);
        $this->assertJmapGetOutcome($response, $target['messageId'], $case);
    }

    /**
     * The actor syncs from a state, the owner then posts a message. An
     * invisible channel is forged into the actor's state, as a hostile
     * client would.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapMessageChanges(OwnershipCase $case, array $target): void
    {
        $own = new OwnershipCase($case->operation, $case->actor, $case->scope, Outcome::Allowed);
        $state = (string) $this->jmapCall($own, 'ChatMessage/get', ['ids' => []])->json('methodResponses.0.1.state');
        $tokens = JmapAccountStateCodec::decompose($state) ?? [];
        if (! isset($tokens[$target['channelId']])) {
            $tokens[$target['channelId']] = '1';
        }
        $newMessageId = $this->postMessage($target['owner'], $target['channelId'], 'after state');

        $response = $this->jmapCall($case, 'ChatMessage/changes', ['sinceState' => JmapAccountStateCodec::compose($tokens)]);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($newMessageId, (array) $response->json('methodResponses.0.1.created'), $case->key());

            return;
        }
        $this->assertJmapChangesOutcome($response, [$newMessageId, $target['messageId']], $case);
    }

    /**
     * ChatMessage/query without a filter, and filtered on the target channel.
     * A hidden channel in the filter answers exactly like a channel id that
     * never existed.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapMessageQuery(OwnershipCase $case, array $target): void
    {
        $query = fn (array $filter): TestResponse => $this->jmapCall($case, 'ChatMessage/query', $filter === [] ? [] : ['filter' => $filter]);
        if ($case->outcome === Outcome::AccountNotFound) {
            $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), fn (): TestResponse => $query(['inChannel' => $target['channelId']]), $case->key());
            $this->assertJmapMethodError($response, 'accountNotFound', $case);
            $this->assertNoTargetContent($response, $target, $case);

            return;
        }
        $ids = function (TestResponse $response) use ($case): array {
            $response->assertOk();
            $this->assertSame('ChatMessage/query', $response->json('methodResponses.0.0'), $case->key().': '.json_encode($response->json('methodResponses.0')));

            return array_map('strval', (array) $response->json('methodResponses.0.1.ids'));
        };

        $all = $ids($query([]));
        $inChannel = $query(['inChannel' => $target['channelId']]);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['messageId'], $all, $case->key().': message missing from the unfiltered query.');
            $this->assertContains($target['messageId'], $ids($inChannel), $case->key().': message missing from the channel query.');

            return;
        }

        $this->assertIdsAbsent([$target['messageId']], $all, $case->key());
        $this->assertSame([], $ids($inChannel), $case->key().': hidden channel matched messages.');
        $missing = $query(['inChannel' => 'chat-'.Str::ulid()])->json('methodResponses.0');
        $this->assertSame($missing, $inChannel->json('methodResponses.0'), $case->key().': hidden and missing channels differ.');
    }

    /**
     * ChatMessage/queryChanges refuses every query, so a hidden channel in
     * the filter gets the same refusal and none of its ids.
     *
     * @param  array{owner: string, channelId: string, messageId: string}  $target
     */
    private function runJmapMessageQueryChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->jmapCall($case, 'ChatMessage/queryChanges', ['sinceQueryState' => '0', 'filter' => ['inChannel' => $target['channelId']]]),
            $case->key(),
        );
        $this->assertJmapMethodError($response, $case->outcome === Outcome::AccountNotFound ? 'accountNotFound' : 'cannotCalculateChanges', $case);
        $this->assertStringNotContainsString($target['messageId'], (string) $response->getContent(), $case->key());
        $this->assertNoTargetContent($response, $target, $case);
    }

    /**
     * @param  list<string>  $ids
     */
    private function assertJmapChangesOutcome(TestResponse $response, array $ids, OwnershipCase $case): void
    {
        if ($case->outcome === Outcome::AccountNotFound) {
            $this->assertJmapMethodError($response, 'accountNotFound', $case);

            return;
        }
        $response->assertOk();
        $this->assertSame(['ChatChannel/changes', 'ChatMessage/changes'][str_contains($case->operation, 'ChatMessage') ? 1 : 0], $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
        $args = (array) $response->json('methodResponses.0.1');
        $listed = array_map('strval', array_merge((array) ($args['created'] ?? []), (array) ($args['updated'] ?? []), (array) ($args['destroyed'] ?? [])));
        if ($case->outcome === Outcome::Allowed) {
            foreach ($ids as $id) {
                $this->assertContains($id, $listed, $case->key());
            }

            return;
        }
        $this->assertIdsAbsent($ids, $listed, $case->key());
    }

    // ---- Anonymous -------------------------------------------------------

    private function runAnonymous(OwnershipCase $case): void
    {
        [$method, $path] = explode(' ', $case->operation, 2);
        $uri = strtr($path, [
            '{channelId}' => 'chat-anything',
            '{messageId}' => (string) Str::ulid(),
        ]);
        $this->assertRestOutcome($this->requestAs(Actor::Anonymous, $method, $uri), $case);
    }
}
