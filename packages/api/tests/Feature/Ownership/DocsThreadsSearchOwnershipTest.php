<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Jmap\FileNodes\FileNodeReindexer;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Search\SearchIndexerService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
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
 * Ownership matrix for Docs threads and unified search (plan chunk-g-drive,
 * threads and search half).
 *
 * Threads hang off a Docs file and are authorized by the drive rights on its
 * path. Each thread case seeds one Doc with one thread, owned and shared as
 * the scope describes. Drive share levels map onto the grant scopes:
 * `*-read` is `view` (variant `comment` for the comment level), `*-write` and
 * `user-to-actor-group` are `edit` (variant `full` for the full level). Drive
 * member grants have no sharee-side dismissal, so `grant-dismissed` does not
 * apply.
 *
 * Search cases seed one object of every searchable source in the scope
 * through the real APIs, then run the same reindex an admin search job runs,
 * because chat messages and thread journals are only indexed by it.
 */
final class DocsThreadsSearchOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    private const THREAD_READ_OPS = [
        'GET /files/threads',
        'GET /files/threads/changes',
    ];

    private const THREAD_COMMENT_OPS = [
        'POST /files/threads',
        'POST /files/threads/{threadId}/replies',
        'POST /files/threads/{threadId}/reactions',
    ];

    private const THREAD_PATCH = 'PATCH /files/threads/{threadId}';

    private const SEARCH = 'GET /search/results';

    private const SEARCH_CONTENT = 'GET /search/results/{resultId}/content';

    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3';

    private const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const VISIBLE = [
        Scope::OwnUser, Scope::OwnGroup,
        Scope::UserToActorRead, Scope::UserToActorWrite,
        Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
        Scope::UserToActorGroup,
    ];

    /** Grant scopes where the sharee finds the shared collection and nothing else of the owner. */
    private const SEARCH_GRANT_SCOPES = [
        Scope::UserToActorRead, Scope::UserToActorWrite,
        Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
        Scope::UserToActorGroup,
    ];

    private const SEARCH_SCOPES = [
        Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup, Scope::GrantRevoked,
        ...self::SEARCH_GRANT_SCOPES,
    ];

    /** Sources a sharee gets its own index rows for (calendar-backed collections). */
    private const SHAREABLE_SOURCES = ['note', 'task', 'event', 'chat'];

    private const ALL_SOURCES = ['note', 'task', 'event', 'contact', 'chat', 'file', 'thread'];

    private string $dataDir = '';

    private int $ulidCounter = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->dataDir = storage_path('framework/testing/wgw-ownership-threads-'.uniqid('', true));
        foreach ([OwnershipPrincipals::MEMBER, OwnershipPrincipals::ADMIN, OwnershipPrincipals::CAROL, OwnershipPrincipals::DAVE] as $username) {
            File::ensureDirectoryExists($this->dataDir.'/files/users/'.$username);
        }
        foreach (array_keys(OwnershipPrincipals::memberships()) as $slug) {
            File::ensureDirectoryExists($this->dataDir.'/files/groups/'.$slug);
        }
        WgwTestDisks::refresh($this->dataDir);

        $this->seedOwnershipWorld();
        $this->setAppSettings([
            WgwSettings::FILES_ENABLED => true,
            WgwSettings::CALENDAR_ENABLED => true,
            WgwSettings::CONTACTS_ENABLED => true,
            WgwSettings::TASKS_ENABLED => true,
            WgwSettings::NOTES_ENABLED => true,
        ]);
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        $threadScopes = [
            [Scope::OwnUser, null], [Scope::OwnGroup, null],
            [Scope::OtherUser, null], [Scope::OtherGroup, null], [Scope::FormerGroup, null],
            [Scope::UserToActorRead, null], [Scope::UserToActorRead, 'comment'],
            [Scope::UserToActorWrite, null], [Scope::UserToActorWrite, 'full'],
            [Scope::GroupToNonmemberRead, null], [Scope::GroupToNonmemberWrite, null],
            [Scope::UserToActorGroup, null], [Scope::GrantRevoked, null],
        ];

        foreach (Actor::signedIn() as $actor) {
            foreach ($threadScopes as [$scope, $level]) {
                $visible = in_array($scope, self::VISIBLE, true);
                $access = self::accessFor($scope, $level);
                // Drive rights have no admin case, so the extra levels run
                // as member only. `full` differs from `edit` only on PATCH.
                if ($level !== null && $actor === Actor::Admin) {
                    continue;
                }
                $patch = ! $visible ? Outcome::NotFound : (in_array($access, ['view', 'comment'], true) ? Outcome::Forbidden : Outcome::Allowed);
                if ($level === 'full') {
                    $cases[] = OwnershipCase::of(self::THREAD_PATCH, $actor, $scope, $patch)->variant($level);

                    continue;
                }

                foreach (self::THREAD_READ_OPS as $op) {
                    $cases[] = self::withVariant(OwnershipCase::of($op, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound), $level);
                }
                foreach (self::THREAD_COMMENT_OPS as $op) {
                    $outcome = ! $visible ? Outcome::NotFound : ($access === 'view' ? Outcome::Forbidden : Outcome::Allowed);
                    $cases[] = self::withVariant(OwnershipCase::of($op, $actor, $scope, $outcome), $level);
                }

                // Resolving someone else's thread needs edit rights on the Doc.
                $cases[] = self::withVariant(OwnershipCase::of(self::THREAD_PATCH, $actor, $scope, $patch), $level);
            }

            // A commenter may resolve the thread it started.
            if ($actor === Actor::Member) {
                $cases[] = OwnershipCase::of(self::THREAD_PATCH, $actor, Scope::UserToActorRead, Outcome::Allowed)->variant('comment-own-thread');
            }

            // The path names a Doc the actor may edit; the thread lives on
            // another Doc of the same owner that is not shared.
            foreach (['POST /files/threads/{threadId}/replies', 'POST /files/threads/{threadId}/reactions', self::THREAD_PATCH] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::NotFound)->variant('via-shared-doc');
            }
            $cases[] = OwnershipCase::of(self::THREAD_PATCH, $actor, Scope::OtherUser, Outcome::NotFound)->variant('change-id-via-shared-doc');

            // Group membership is checked per request: leaving `crew` ends the access.
            if ($actor === Actor::Member) {
                $cases[] = OwnershipCase::of('GET /files/threads', $actor, Scope::UserToActorGroup, Outcome::NotFound)->variant('left-crew');
            }

            foreach (self::SEARCH_SCOPES as $scope) {
                $allowed = in_array($scope, [Scope::OwnUser, Scope::OwnGroup, ...self::SEARCH_GRANT_SCOPES], true);
                $cases[] = OwnershipCase::of(self::SEARCH, $actor, $scope, $allowed ? Outcome::Allowed : Outcome::NotFound);
                $cases[] = OwnershipCase::of(self::SEARCH_CONTENT, $actor, $scope, $allowed ? Outcome::Allowed : Outcome::NotFound);
            }
            foreach (['malformed-key', 'file-source'] as $variant) {
                $cases[] = OwnershipCase::of(self::SEARCH_CONTENT, $actor, Scope::OtherUser, Outcome::NotFound)->variant($variant);
            }
            // Neither a decodable result id nor the query parameters.
            $cases[] = OwnershipCase::of(self::SEARCH_CONTENT, $actor, Scope::OtherUser, Outcome::Rejected)->variant('undecodable');
        }

        foreach (array_merge(self::THREAD_READ_OPS, self::THREAD_COMMENT_OPS, [self::THREAD_PATCH, self::SEARCH, self::SEARCH_CONTENT]) as $op) {
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

    private static function withVariant(OwnershipCase $case, ?string $variant): OwnershipCase
    {
        return $variant === null ? $case : $case->variant($variant);
    }

    /**
     * The drive access level the actor holds on the Doc.
     */
    private static function accessFor(Scope $scope, ?string $level): ?string
    {
        return match ($scope) {
            Scope::OwnUser, Scope::OwnGroup => 'full',
            Scope::UserToActorRead, Scope::GroupToNonmemberRead => $level ?? 'view',
            Scope::UserToActorWrite, Scope::GroupToNonmemberWrite, Scope::UserToActorGroup => $level ?? 'edit',
            Scope::GrantRevoked => 'edit',
            default => null,
        };
    }

    private function runCase(OwnershipCase $case): void
    {
        if ($case->actor === Actor::Anonymous) {
            $this->runAnonymous($case);

            return;
        }

        match ($case->operation) {
            self::SEARCH => $this->runSearch($case),
            self::SEARCH_CONTENT => $this->runSearchContent($case),
            default => $this->runThreadCase($case),
        };
    }

    private function runAnonymous(OwnershipCase $case): void
    {
        $path = '?path='.urlencode('/users/carol/doc.md');
        $threadId = $this->nextUlid();
        [$method, $uri] = match ($case->operation) {
            'GET /files/threads' => ['GET', '/files/threads'.$path],
            'GET /files/threads/changes' => ['GET', '/files/threads/changes'.$path],
            'POST /files/threads' => ['POST', '/files/threads'.$path],
            'POST /files/threads/{threadId}/replies' => ['POST', '/files/threads/'.$threadId.'/replies'.$path],
            'POST /files/threads/{threadId}/reactions' => ['POST', '/files/threads/'.$threadId.'/reactions'.$path],
            self::THREAD_PATCH => ['PATCH', '/files/threads/'.$threadId.$path],
            self::SEARCH => ['GET', '/search/results?q=anything'],
            self::SEARCH_CONTENT => ['GET', '/search/results/'.$this->resultIdFor('caldav', 'carol|default|x.ics').'/content'],
            default => throw new LogicException('No anonymous request for '.$case->operation),
        };

        $this->assertRestOutcome($this->requestAs(Actor::Anonymous, $method, $uri), $case);
    }

    // ---- Threads: target seeding ------------------------------------------

    /**
     * @return array{owner: string, path: string, threadId: string, body: string}
     */
    private function seedThreadTarget(OwnershipCase $case): array
    {
        $actor = $case->actor;
        $self = $this->usernameFor($actor);
        $carol = OwnershipPrincipals::CAROL;
        $otherActor = $this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin);
        $name = 'doc-'.$case->scope->value.'.md';

        [$owner, $root] = match ($case->scope) {
            Scope::OwnUser => [$self, '/users/'.$self],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, '/groups/'.OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, '/groups/'.OwnershipPrincipals::OUTSIDERS],
            Scope::FormerGroup => [$otherActor, '/groups/'.OwnershipPrincipals::ALUMNI],
            // Epic #1915: a Team share needs an owner in that Team; dave is in crew.
            Scope::UserToActorGroup => [OwnershipPrincipals::DAVE, '/users/'.OwnershipPrincipals::DAVE],
            default => [$carol, '/users/'.$carol],
        };
        $path = $root.'/'.$name;
        $this->putDoc($path);

        // On the actor's own Doc a commenter starts the thread, so resolving
        // it is a non-author write too.
        $author = $owner;
        if ($case->scope === Scope::OwnUser && $case->operation === self::THREAD_PATCH) {
            $this->shareDoc($owner, $path, $carol, 'comment');
            $author = $carol;
        }

        $access = self::accessFor($case->scope, match ($case->variant) {
            'comment-own-thread' => 'comment',
            'left-crew' => null,
            default => $case->variant,
        });
        $shareId = null;
        switch ($case->scope) {
            case Scope::UserToActorRead:
            case Scope::UserToActorWrite:
            case Scope::GroupToNonmemberRead:
            case Scope::GroupToNonmemberWrite:
            case Scope::GrantRevoked:
                $shareId = $this->shareDoc($owner, $path, $self, (string) $access);
                break;
            case Scope::UserToActorGroup:
                $this->shareDoc($owner, $path, 'groups/'.OwnershipPrincipals::CREW, (string) $access);
                break;
            default:
                break;
        }

        $body = $case->variant === 'comment-own-thread' ? 'from the commenter' : 'thread on '.$case->scope->value;
        $threadId = $this->createThread($case->variant === 'comment-own-thread' ? $self : $author, $path, $body);

        if ($case->scope === Scope::GrantRevoked && $shareId !== null) {
            $this->requestAsUsername($owner, 'DELETE', '/files/shares/'.$shareId)->assertSuccessful();
        }
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($actor);
        }

        return ['owner' => $owner, 'path' => $path, 'threadId' => $threadId, 'body' => $body];
    }

    /**
     * Places a Docs file on disk, as the Docs fixtures do. Thread access is
     * decided on the path alone.
     */
    private function putDoc(string $path): void
    {
        File::ensureDirectoryExists(dirname($this->dataDir.'/files'.$path));
        File::put($this->dataDir.'/files'.$path, "# Doc\n\nBody\n");
    }

    private function shareDoc(string $owner, string $path, string $grantee, string $access): string
    {
        return (string) $this->requestAsUsername($owner, 'POST', '/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [$grantee => ['access' => $access]],
        ])->assertOk()->json('data.id');
    }

    private function createThread(string $author, string $path, string $body, ?string $changeId = null): string
    {
        $id = $this->nextUlid();
        $payload = ['id' => $id, 'kind' => $changeId === null ? 'comment' : 'suggestion', 'body' => $body, 'anchorText' => 'Doc'];
        if ($changeId !== null) {
            $payload['changeId'] = $changeId;
        }
        $this->requestAsUsername($author, 'POST', '/files/threads?path='.urlencode($path), $payload)->assertCreated();

        return $id;
    }

    private function nextUlid(): string
    {
        $n = $this->ulidCounter++;

        return self::ULID_PREFIX
            .self::ULID_ALPHABET[intdiv($n, 1024) % 32]
            .self::ULID_ALPHABET[intdiv($n, 32) % 32]
            .self::ULID_ALPHABET[$n % 32]
            .'A';
    }

    /**
     * The owner's view of the threads on a Doc, for proving a denied write
     * changed nothing.
     *
     * @return list<array<string, mixed>>
     */
    private function threadSnapshot(string $owner, string $path): array
    {
        $rows = $this->requestAsUsername($owner, 'GET', '/files/threads?path='.urlencode($path))->assertOk()->json('list');
        $out = [];
        foreach (is_array($rows) ? $rows : [] as $thread) {
            $out[] = [
                'id' => $thread['id'] ?? null,
                'resolved' => $thread['resolved'] ?? null,
                'archived' => $thread['archived'] ?? null,
                'messages' => array_column(is_array($thread['messages'] ?? null) ? $thread['messages'] : [], 'id'),
                'reactions' => $thread['reactions'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function ownerThread(string $owner, string $path, string $threadId): ?array
    {
        $rows = $this->requestAsUsername($owner, 'GET', '/files/threads?path='.urlencode($path))->assertOk()->json('list');
        foreach (is_array($rows) ? $rows : [] as $thread) {
            if (($thread['id'] ?? null) === $threadId) {
                return $thread;
            }
        }

        return null;
    }

    /**
     * @param  array<mixed>  $reactions
     * @return list<string>
     */
    private function reactionUsers(array $reactions): array
    {
        $users = [];
        foreach ($reactions as $reaction) {
            foreach ((array) ($reaction['userIds'] ?? []) as $user) {
                $users[] = (string) $user;
            }
        }

        return $users;
    }

    // ---- Threads: runners -------------------------------------------------

    private function runThreadCase(OwnershipCase $case): void
    {
        if (in_array($case->variant, ['via-shared-doc', 'change-id-via-shared-doc'], true)) {
            $this->runViaSharedDoc($case);

            return;
        }

        $target = $this->seedThreadTarget($case);
        $query = '?path='.urlencode($target['path']);
        if ($case->variant === 'left-crew') {
            $this->runLeftCrew($case, $target, '/files/threads'.$query);

            return;
        }

        match ($case->operation) {
            'GET /files/threads' => $this->runThreadIndex($case, $target, '/files/threads'.$query),
            'GET /files/threads/changes' => $this->runThreadChanges($case, $target, '/files/threads/changes'.$query),
            default => $this->runThreadWrite($case, $target, $query),
        };
    }

    /**
     * @param  array{owner: string, path: string, threadId: string, body: string}  $target
     */
    private function runLeftCrew(OwnershipCase $case, array $target, string $uri): void
    {
        $listed = fn (TestResponse $response): array => array_column(is_array($response->json('list')) ? $response->json('list') : [], 'id');
        $this->assertContains($target['threadId'], $listed($this->requestAs($case->actor, 'GET', $uri)), $case->key());

        $this->assertUnchanged(fn () => $this->threadSnapshot($target['owner'], $target['path']), fn () => $this->leaveCrew($case->actor), $case->key());

        // Same token as before leaving.
        $response = $this->requestAs($case->actor, 'GET', $uri);
        $this->assertIdsAbsent([$target['threadId']], $listed($response), $case->key());
        $this->assertNoThreadContent($response, $target, $case);
        $this->assertRestOutcome($response, $case);
        $this->assertContains($target['threadId'], $listed($this->requestAsUsername(OwnershipPrincipals::DAVE, 'GET', $uri)), $case->key().': dave lost access.');
    }

    /**
     * @param  array{owner: string, path: string, threadId: string, body: string}  $target
     */
    private function runThreadIndex(OwnershipCase $case, array $target, string $uri): void
    {
        $response = $this->requestAs($case->actor, 'GET', $uri);
        $listed = array_column(is_array($response->json('list')) ? $response->json('list') : [], 'id');
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($response, $case);
            $this->assertContains($target['threadId'], $listed, $case->key());

            return;
        }

        $this->assertIdsAbsent([$target['threadId']], $listed, $case->key());
        $this->assertNoThreadContent($response, $target, $case);
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array{owner: string, path: string, threadId: string, body: string}  $target
     */
    private function runThreadChanges(OwnershipCase $case, array $target, string $uri): void
    {
        $response = $this->requestAs($case->actor, 'GET', $uri);
        $changed = array_merge(
            array_map('strval', (array) $response->json('created')),
            array_map('strval', (array) $response->json('updated')),
        );
        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($response, $case);
            $this->assertContains($target['threadId'], $changed, $case->key());

            return;
        }

        $this->assertIdsAbsent([$target['threadId']], $changed, $case->key());
        $this->assertNoThreadContent($response, $target, $case);
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array{owner: string, path: string, threadId: string, body: string}  $target
     */
    private function runThreadWrite(OwnershipCase $case, array $target, string $query): void
    {
        $newId = $this->nextUlid();
        [$method, $uri, $body] = match ($case->operation) {
            'POST /files/threads' => ['POST', '/files/threads'.$query, ['id' => $newId, 'kind' => 'comment', 'body' => 'by actor', 'anchorText' => 'Doc']],
            'POST /files/threads/{threadId}/replies' => ['POST', '/files/threads/'.$target['threadId'].'/replies'.$query, ['id' => $newId, 'body' => 'reply by actor']],
            'POST /files/threads/{threadId}/reactions' => ['POST', '/files/threads/'.$target['threadId'].'/reactions'.$query, ['emoji' => '+1']],
            self::THREAD_PATCH => ['PATCH', '/files/threads/'.$target['threadId'].$query, ['resolved' => true]],
            default => throw new LogicException('No thread runner for '.$case->operation),
        };
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, $uri, $body);

        if ($case->outcome !== Outcome::Allowed) {
            $response = $this->assertUnchanged(fn () => $this->threadSnapshot($target['owner'], $target['path']), $send, $case->key());
            $this->assertNoThreadContent($response, $target, $case);
            $this->assertRestOutcome($response, $case);

            return;
        }

        $this->assertRestOutcome($send(), $case);
        $self = $this->usernameFor($case->actor);
        match ($case->operation) {
            'POST /files/threads' => $this->assertNotNull($this->ownerThread($target['owner'], $target['path'], $newId), $case->key().': thread missing for the owner.'),
            'POST /files/threads/{threadId}/replies' => $this->assertContains(
                $newId,
                array_column((array) ($this->ownerThread($target['owner'], $target['path'], $target['threadId'])['messages'] ?? []), 'id'),
                $case->key().': reply missing for the owner.',
            ),
            'POST /files/threads/{threadId}/reactions' => $this->assertContains(
                $self,
                $this->reactionUsers((array) ($this->ownerThread($target['owner'], $target['path'], $target['threadId'])['reactions'] ?? [])),
                $case->key().': reaction missing for the owner.',
            ),
            default => $this->assertTrue(
                (bool) ($this->ownerThread($target['owner'], $target['path'], $target['threadId'])['resolved'] ?? false),
                $case->key().': thread not resolved for the owner.',
            ),
        };
    }

    /**
     * A refused thread request carries none of the target thread's content.
     *
     * @param  array{owner: string, path: string, threadId: string, body: string}  $target
     */
    private function assertNoThreadContent(TestResponse $response, array $target, OwnershipCase $case): void
    {
        $content = (string) $response->getContent();
        $this->assertStringNotContainsString($target['body'], $content, $case->key().': thread body in the response.');
        $this->assertStringNotContainsString('"messages"', $content, $case->key().': thread messages in the response.');
    }

    /**
     * The actor may edit carol's Doc A. Carol's thread sits on Doc B, which
     * is not shared. The request names A in the path and B's thread.
     */
    private function runViaSharedDoc(OwnershipCase $case): void
    {
        $carol = OwnershipPrincipals::CAROL;
        $self = $this->usernameFor($case->actor);
        $sharedPath = '/users/'.$carol.'/shared-doc.md';
        $privatePath = '/users/'.$carol.'/private-doc.md';
        $this->putDoc($sharedPath);
        $this->putDoc($privatePath);
        $this->shareDoc($carol, $sharedPath, $self, 'edit');
        $changeId = $case->variant === 'change-id-via-shared-doc' ? 'change-private' : null;
        $threadId = $this->createThread($carol, $privatePath, 'private thread', $changeId);
        $query = '?path='.urlencode($sharedPath);

        [$method, $uri, $body] = match ($case->operation) {
            'POST /files/threads/{threadId}/replies' => ['POST', '/files/threads/'.$threadId.'/replies'.$query, ['id' => $this->nextUlid(), 'body' => 'reply by actor']],
            'POST /files/threads/{threadId}/reactions' => ['POST', '/files/threads/'.$threadId.'/reactions'.$query, ['emoji' => '+1']],
            self::THREAD_PATCH => $changeId === null
                ? ['PATCH', '/files/threads/'.$threadId.$query, ['resolved' => true]]
                : ['PATCH', '/files/threads/'.$this->nextUlid().$query, ['changeId' => $changeId, 'resolved' => true]],
            default => throw new LogicException('No via-shared-doc runner for '.$case->operation),
        };

        $response = $this->assertUnchanged(
            fn () => $this->threadSnapshot($carol, $privatePath),
            fn (): TestResponse => $this->requestAs($case->actor, $method, $uri, $body),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);
    }

    // ---- Search: seeding --------------------------------------------------

    /**
     * Seeds one object per searchable source in the scope and reindexes.
     *
     * `unsharedMarker` names a second set of the same sources, owned by the
     * same owner and shared with nobody. Grant scopes and grant-revoked have it.
     *
     * @return array{owner: string, marker: string, unsharedMarker: ?string, sources: list<string>, actorKeysBefore: list<array{0: string, 1: string}>}
     */
    private function seedSearchScope(OwnershipCase $case): array
    {
        $actor = $case->actor;
        $self = $this->usernameFor($actor);
        $otherActor = $this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin);
        $marker = 'zq'.str_replace('-', '', $case->scope->value).($actor === Actor::Admin ? 'adm' : 'mem');

        [$owner, $group] = match ($case->scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [OwnershipPrincipals::CAROL, OwnershipPrincipals::OUTSIDERS],
            Scope::FormerGroup => [$otherActor, OwnershipPrincipals::ALUMNI],
            Scope::UserToActorGroup => [OwnershipPrincipals::DAVE, null],
            default => [OwnershipPrincipals::CAROL, null],
        };

        $granted = in_array($case->scope, self::SEARCH_GRANT_SCOPES, true);
        $shared = $granted || $case->scope === Scope::GrantRevoked;
        $grantee = $case->scope === Scope::UserToActorGroup ? 'groups/'.OwnershipPrincipals::CREW : $self;
        $write = in_array($case->scope, [Scope::UserToActorWrite, Scope::GroupToNonmemberWrite, Scope::UserToActorGroup], true);
        $unsharedMarker = $shared ? 'zqun'.substr($marker, 2) : null;

        $sources = $shared ? self::SHAREABLE_SOURCES : self::ALL_SOURCES;
        $revokers = [];
        foreach ($sources as $source) {
            $revoker = $this->seedSource($source, $owner, $group, $marker, $shared ? $grantee : null, $write);
            if ($revoker !== null) {
                $revokers[] = $revoker;
            }
            if ($unsharedMarker !== null) {
                $this->seedSource($source, $owner, $group, $unsharedMarker, null);
            }
        }

        $this->reindex();

        $actorKeysBefore = [];
        if ($case->scope === Scope::GrantRevoked) {
            // The sharee's own index rows exist now, for the shared sources only; the owner then revokes.
            $before = $this->search($self, $marker);
            $this->assertSame($this->sorted($sources), $this->sourcesFound($before, $marker), $case->key().': sharee hits before the revoke are not the shared sources.');
            $this->assertSame([], $this->sourcesFound($this->search($self, (string) $unsharedMarker), (string) $unsharedMarker), $case->key().': unshared sources found before the revoke.');
            $actorKeysBefore = $this->resultKeys($before);
            foreach ($revokers as $revoke) {
                $revoke();
            }
        }
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($actor);
        }

        return ['owner' => $owner, 'marker' => $marker, 'unsharedMarker' => $unsharedMarker, 'sources' => $sources, 'actorKeysBefore' => $actorKeysBefore];
    }

    /**
     * Creates one object of a source as its owner. With a sharee, the
     * collection is shared to it and a callback that revokes the share is
     * returned.
     */
    private function seedSource(string $source, string $owner, ?string $group, string $marker, ?string $sharee, bool $write = false): ?callable
    {
        $groupPayload = $group === null ? [] : ['groupSlug' => $group];

        switch ($source) {
            case 'note':
                $notebookId = (string) $this->requestAsUsername($owner, 'POST', '/notes/notebooks', ['name' => $marker.' notebook'] + $groupPayload)
                    ->assertCreated()->json('id');
                $this->requestAsUsername($owner, 'POST', '/notes/items', [
                    'notebookId' => $notebookId, 'title' => $marker.' note', 'body' => $marker.' note body',
                ])->assertCreated();

                return $sharee === null ? null : $this->shareCollection($owner, '/notes/notebooks/'.$notebookId, $sharee, $write);
            case 'task':
                $listId = (string) $this->requestAsUsername($owner, 'POST', '/tasks/tasklists', ['name' => $marker.' list'] + $groupPayload)
                    ->assertCreated()->json('id');
                $this->requestAsUsername($owner, 'POST', '/tasks/items', [
                    'taskListIds' => [$listId => true], 'title' => $marker.' task',
                ])->assertCreated();

                return $sharee === null ? null : $this->shareCollection($owner, '/tasks/tasklists/'.$listId, $sharee, $write);
            case 'event':
                return $this->seedEvent($owner, $groupPayload, $marker, $sharee, $write);
            case 'contact':
                $this->seedContact($owner, $group, $marker);

                return null;
            case 'chat':
                $channelId = (string) $this->requestAsUsername($owner, 'POST', '/chat/channels', [
                    'name' => $marker.' channel', 'kind' => 'channel',
                ] + $groupPayload)->assertCreated()->json('id');
                $this->requestAsUsername($owner, 'POST', '/chat/channels/'.$channelId.'/messages', [
                    'id' => $this->nextUlid(), 'body' => $marker.' chat message',
                ])->assertCreated();

                return $sharee === null ? null : $this->shareCollection($owner, '/chat/channels/'.$channelId, $sharee, $write);
            case 'file':
                $this->createDriveFile($owner, $group, $marker.'-file.md', '# '.$marker." file\n");

                return null;
            case 'thread':
                $root = $group === null ? '/users/'.$owner : '/groups/'.$group;
                $path = $root.'/'.$marker.'-doc.md';
                $this->putDoc($path);
                $this->createThread($owner, $path, $marker.' thread comment');

                return null;
            default:
                throw new LogicException('Unknown source '.$source);
        }
    }

    private function shareCollection(string $owner, string $uri, string $sharee, bool $write): callable
    {
        $this->requestAsUsername($owner, 'PATCH', $uri, ['shareWith' => [$sharee => $write ? ['mayWriteAll' => true] : ['mayReadItems' => true]]])->assertOk();

        return fn () => $this->requestAsUsername($owner, 'PATCH', $uri, ['shareWith' => [$sharee => null]])->assertOk();
    }

    /**
     * @param  array<string, string>  $groupPayload
     */
    private function seedEvent(string $owner, array $groupPayload, string $marker, ?string $sharee, bool $write): ?callable
    {
        $calendarId = (string) $this->ownerJmap($owner, JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => $owner, 'create' => ['c' => ['name' => $marker.' calendar'] + $groupPayload]], 'c0'],
        ])->json('methodResponses.0.1.created.c.id');
        $this->assertNotSame('', $calendarId, 'calendar not created for '.$owner);

        $created = $this->ownerJmap($owner, JmapCapabilities::CALENDARS, [
            ['CalendarEvent/set', ['accountId' => $owner, 'create' => ['e' => [
                'calendarIds' => [$calendarId => true],
                'title' => $marker.' event',
                'start' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 14:00 UTC')),
                'end' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 15:00 UTC')),
            ]]], 'c0'],
        ])->json('methodResponses.0.1.created.e.id');
        $this->assertIsString($created, 'event not created for '.$owner);

        if ($sharee === null) {
            return null;
        }
        $share = fn (?array $rights) => $this->ownerJmap($owner, JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$calendarId => ['shareWith' => [$sharee => $rights]]]], 'c0'],
        ]);
        $this->assertEmpty($share($write ? ['mayWriteAll' => true] : ['mayReadItems' => true])->json('methodResponses.0.1.notUpdated'));

        return fn () => $this->assertEmpty($share(null)->json('methodResponses.0.1.notUpdated'));
    }

    private function seedContact(string $owner, ?string $group, string $marker): void
    {
        $provisioner = app(AddressBookProvisioner::class);
        if ($group === null) {
            $provisioner->ensureForPrincipal('principals/'.$owner, ucfirst($owner));
            $bookId = 'default';
        } else {
            $provisioner->ensureForGroupPrincipal(OwnershipPrincipals::groupUri($group), ucfirst($group));
            $bookId = 'group-'.$group;
        }

        $created = $this->ownerJmap($owner, JmapCapabilities::CONTACTS, [
            ['ContactCard/set', ['accountId' => $owner, 'create' => ['k' => [
                'addressBookIds' => [$bookId => true],
                'name' => ['full' => $marker.' contact'],
            ]]], 'c0'],
        ])->json('methodResponses.0.1.created.k.id');
        $this->assertIsString($created, 'contact not created for '.$owner.' in '.$bookId);
    }

    private function createDriveFile(string $owner, ?string $group, string $name, string $contents): void
    {
        $homeName = $group ?? $owner;
        $nodes = $this->ownerJmap($owner, JmapCapabilities::FILENODE, [
            ['FileNode/get', ['accountId' => $owner, 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.list');
        $homeId = null;
        foreach (is_array($nodes) ? $nodes : [] as $node) {
            if (($node['parentId'] ?? null) === null && strcasecmp((string) ($node['name'] ?? ''), $homeName) === 0) {
                $homeId = $node['id'];
                break;
            }
        }
        $this->assertNotNull($homeId, 'no drive home '.$homeName.' for '.$owner.': '.json_encode($nodes));

        $blobId = (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/'.$owner,
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->bearerFor($owner),
                'Content-Type' => 'text/markdown',
            ]),
            content: $contents,
        )->assertSuccessful()->json('blobId');

        $this->ownerJmap($owner, JmapCapabilities::FILENODE, [
            ['FileNode/set', ['accountId' => $owner, 'create' => [
                'f' => ['parentId' => $homeId, 'name' => $name, 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertJsonPath('methodResponses.0.1.created.f.name', $name);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function ownerJmap(string $owner, string $capability, array $methodCalls): TestResponse
    {
        return $this->requestAsUsername($owner, 'POST', '/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }

    private function bearerFor(string $username): string
    {
        return match ($username) {
            OwnershipPrincipals::MEMBER => (string) $this->tokenFor(Actor::Member),
            OwnershipPrincipals::ADMIN => (string) $this->tokenFor(Actor::Admin),
            default => $this->mintUserToken($username, 'user'),
        };
    }

    /**
     * The reindex an admin search job runs.
     */
    private function reindex(): void
    {
        app(FileNodeReindexer::class)->reindexAll();
        app(SearchIndexerService::class)->reindexAllFromFileNodes();
    }

    private function search(string $username, string $marker): TestResponse
    {
        return $this->requestAsUsername($username, 'GET', '/search/results?'.http_build_query(['q' => $marker, 'limit' => 100]))->assertOk();
    }

    /**
     * @return list<array{0: string, 1: string}> [sourceType, sourceKey]
     */
    private function resultKeys(TestResponse $response): array
    {
        $keys = [];
        foreach ((array) $response->json('data.results') as $row) {
            $keys[] = [(string) ($row['sourceType'] ?? ''), (string) ($row['sourceKey'] ?? '')];
        }

        return $keys;
    }

    /**
     * Which seeded sources a search response contains, by the marker in the
     * title or snippet.
     *
     * @return list<string>
     */
    private function sourcesFound(TestResponse $response, string $marker): array
    {
        $found = [];
        foreach ((array) $response->json('data.results') as $row) {
            $text = strtolower(((string) ($row['title'] ?? '')).' '.((string) ($row['snippet'] ?? '')));
            if (! str_contains($text, $marker)) {
                continue;
            }
            foreach (self::ALL_SOURCES as $source) {
                if (str_contains($text, $marker.' '.$source) || str_contains($text, $marker.'-'.$source)) {
                    $found[$source] = $source;
                }
            }
        }
        ksort($found);

        return array_values($found);
    }

    /**
     * @param  list<string>  $values
     * @return list<string>
     */
    private function sorted(array $values): array
    {
        sort($values);

        return $values;
    }

    private function resultIdFor(string $sourceType, string $sourceKey): string
    {
        return rtrim(strtr(base64_encode((string) json_encode(['source_type' => $sourceType, 'source_key' => $sourceKey])), '+/', '-_'), '=');
    }

    // ---- Search: runners --------------------------------------------------

    private function runSearch(OwnershipCase $case): void
    {
        $target = $this->seedSearchScope($case);
        $expected = $target['sources'];
        sort($expected);

        $self = $this->usernameFor($case->actor);
        // Search answers 200 for every scope; denied scopes are absent.
        $response = $this->search($self, $target['marker']);
        $found = $this->sourcesFound($response, $target['marker']);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($expected, $found, $case->key().': own sources missing from search.');
            if ($target['unsharedMarker'] !== null) {
                $this->assertUnsharedHidden($case, $target, $response);
            }

            return;
        }

        // The owner's search proves every source was indexed, so absence
        // from the actor's results is not vacuous.
        if ($case->scope !== Scope::GrantRevoked) {
            $this->assertSame($expected, $this->sourcesFound($this->search($target['owner'], $target['marker']), $target['marker']), $case->key().': owner sources not indexed.');
        } else {
            $this->assertNotSame([], $target['actorKeysBefore'], $case->key().': sharee had no index rows before the revoke.');
        }
        $this->assertSame([], $found, $case->key().': hits from a denied scope.');
        if ($target['unsharedMarker'] !== null) {
            $this->assertUnsharedHidden($case, $target, $response);
        }
        $actorKeys = array_map(static fn (array $key): string => $key[0].':'.$key[1], $this->resultKeys($response));
        $deniedKeys = array_map(
            static fn (array $key): string => $key[0].':'.$key[1],
            array_merge($target['actorKeysBefore'], $case->scope === Scope::GrantRevoked ? [] : $this->resultKeys($this->search($target['owner'], $target['marker']))),
        );
        $this->assertIdsAbsent($deniedKeys, $actorKeys, $case->key());
    }

    /**
     * The owner's other sources, which the actor has no grant on, are indexed
     * and still absent from the actor's search.
     *
     * @param  array{owner: string, marker: string, unsharedMarker: ?string, sources: list<string>, actorKeysBefore: list<array{0: string, 1: string}>}  $target
     */
    private function assertUnsharedHidden(OwnershipCase $case, array $target, TestResponse $actorSearch): void
    {
        $unshared = (string) $target['unsharedMarker'];
        $expected = $this->sorted($target['sources']);
        $ownerSearch = $this->search($target['owner'], $unshared);
        $this->assertSame($expected, $this->sourcesFound($ownerSearch, $unshared), $case->key().': unshared sources not indexed.');

        $self = $this->usernameFor($case->actor);
        $actorUnshared = $this->search($self, $unshared);
        $this->assertSame([], $this->sourcesFound($actorUnshared, $unshared), $case->key().': unshared sources found by the sharee.');
        $actorKeys = array_map(static fn (array $key): string => $key[0].':'.$key[1], array_merge($this->resultKeys($actorSearch), $this->resultKeys($actorUnshared)));
        $this->assertIdsAbsent(array_map(static fn (array $key): string => $key[0].':'.$key[1], $this->resultKeys($ownerSearch)), $actorKeys, $case->key());
    }

    private function runSearchContent(OwnershipCase $case): void
    {
        if ($case->variant !== null) {
            $this->runMalformedContent($case);

            return;
        }

        $target = $this->seedSearchScope($case);
        $self = $this->usernameFor($case->actor);
        $keys = match (true) {
            $case->outcome === Outcome::Allowed => $this->resultKeys($this->search($self, $target['marker'])),
            $case->scope === Scope::GrantRevoked => $target['actorKeysBefore'],
            default => $this->resultKeys($this->search($target['owner'], $target['marker'])),
        };
        $keys = array_values(array_filter($keys, static fn (array $key): bool => in_array($key[0], ['caldav', 'carddav'], true)));
        $this->assertNotSame([], $keys, $case->key().': no downloadable records seeded.');

        $this->assertContentOutcome($case, $keys, $target['marker']);

        if ($target['unsharedMarker'] !== null) {
            // The owner's unshared records are downloadable by the owner and hidden from the sharee.
            $unsharedKeys = array_values(array_filter(
                $this->resultKeys($this->search($target['owner'], $target['unsharedMarker'])),
                static fn (array $key): bool => in_array($key[0], ['caldav', 'carddav'], true),
            ));
            $this->assertNotSame([], $unsharedKeys, $case->key().': no unshared downloadable records seeded.');
            $denied = new OwnershipCase($case->operation, $case->actor, $case->scope, Outcome::NotFound, null, null, 'unshared');
            $this->assertContentOutcome($denied, $unsharedKeys, $target['unsharedMarker']);
        }
    }

    /**
     * @param  list<array{0: string, 1: string}>  $keys
     */
    private function assertContentOutcome(OwnershipCase $case, array $keys, string $marker): void
    {
        foreach ($keys as [$type, $key]) {
            $byId = $this->requestAs($case->actor, 'GET', '/search/results/'.$this->resultIdFor($type, $key).'/content');
            $this->assertRestOutcome($byId, $this->contentCase($case, $type, $key, 'result-id'));
            $byQuery = $this->requestAs($case->actor, 'GET', '/search/results/lookup/content?'.http_build_query(['source_type' => $type, 'source_key' => $key]));
            $this->assertRestOutcome($byQuery, $this->contentCase($case, $type, $key, 'query'));
            if ($case->outcome === Outcome::NotFound) {
                foreach ([$byId, $byQuery] as $response) {
                    $this->assertStringNotContainsString($marker, strtolower((string) $response->getContent()), $case->key().': record content in a refused response.');
                }
            }
        }
    }

    /**
     * Same expectation, with the key in the failure message.
     */
    private function contentCase(OwnershipCase $case, string $type, string $key, string $encoding): OwnershipCase
    {
        return new OwnershipCase($case->operation, $case->actor, $case->scope, $case->outcome, $case->errorCode, null, $encoding.' '.$type.' '.$key);
    }

    private function runMalformedContent(OwnershipCase $case): void
    {
        $carol = OwnershipPrincipals::CAROL;
        $uri = match ($case->variant) {
            'malformed-key' => '/search/results/'.$this->resultIdFor('caldav', $carol).'/content',
            'undecodable' => '/search/results/%25%25not-a-result%25%25/content',
            default => null,
        };
        if ($case->variant === 'file-source') {
            $this->createDriveFile($carol, null, 'zqcarolfile.md', "# carol file\n");
            $this->reindex();
            $uri = '/search/results/'.$this->resultIdFor('file', 'users/'.$carol.'/zqcarolfile.md').'/content';
        }
        if ($uri === null) {
            throw new LogicException('No malformed request for '.$case->key());
        }

        $this->assertRestOutcome($this->requestAs($case->actor, 'GET', $uri), $case);
    }
}
