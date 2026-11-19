<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\ThreadIndex;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Ownership\Actor;
use Tests\Support\Ownership\Outcome;
use Tests\Support\Ownership\OwnershipAssertions;
use Tests\Support\Ownership\OwnershipCase;
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\Ownership\SeedsTaskListOwnershipTargets;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Ownership matrix for the shared thread routes with the `task` subject type
 * (#2173). Access follows the task's list: whoever sees the task reads its
 * thread, write access posts, read-only access gets 403 on every write, and
 * everyone else gets 404. Each case seeds one list with one task and one
 * comment by the list owner.
 */
final class TaskThreadsOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;
    use SeedsTaskListOwnershipTargets;

    private const READ_OPS = [
        'GET /threads/{subjectType}/{subjectId}/entries',
        'GET /threads/{subjectType}/{subjectId}/changes',
    ];

    private const WRITE_OPS = [
        'POST /threads/{subjectType}/{subjectId}/entries',
        'PATCH /threads/{subjectType}/{subjectId}/entries/{entryId}',
        'DELETE /threads/{subjectType}/{subjectId}/entries/{entryId}',
        'POST /threads/{subjectType}/{subjectId}/entries/{entryId}/reactions',
    ];

    private const VISIBLE = [
        Scope::OwnUser, Scope::OwnGroup,
        Scope::UserToActorRead, Scope::UserToActorWrite,
        Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
        Scope::UserToActorGroup,
    ];

    private const READ_ONLY = [Scope::UserToActorRead, Scope::GroupToNonmemberRead];

    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3';

    private int $ulidCounter = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        $scopes = [
            Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup,
            Scope::UserToActorRead, Scope::UserToActorWrite,
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup, Scope::GrantRevoked, Scope::GrantDismissed,
        ];
        foreach (Actor::signedIn() as $actor) {
            foreach ($scopes as $scope) {
                $visible = in_array($scope, self::VISIBLE, true);
                $readOnly = in_array($scope, self::READ_ONLY, true);
                foreach (self::READ_OPS as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound);
                }
                foreach (self::WRITE_OPS as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed));
                }
            }
        }
        foreach ([...self::READ_OPS, ...self::WRITE_OPS] as $op) {
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

    private function runCase(OwnershipCase $case): void
    {
        $target = $this->seedTarget($case->scope, $case->actor);
        $ownerEntry = (string) $this->requestAsUsername($target['owner'], 'POST', $this->url($target['taskId'], 'entries'), [
            'id' => $this->ulid(),
            'body' => 'owner comment',
        ])->assertCreated()->json('id');

        [$method, $path] = explode(' ', $case->operation, 2);
        $entryId = $ownerEntry;
        if ($case->outcome === Outcome::Allowed && in_array($path, ['/threads/{subjectType}/{subjectId}/entries/{entryId}'], true)) {
            // Edit and delete are the author's own: the actor writes one first.
            $entryId = (string) $this->requestAs($case->actor, 'POST', $this->url($target['taskId'], 'entries'), [
                'id' => $this->ulid(),
                'body' => 'actor comment',
            ])->assertCreated()->json('id');
        }
        $uri = $this->url($target['taskId'], match ($path) {
            '/threads/{subjectType}/{subjectId}/entries' => 'entries',
            '/threads/{subjectType}/{subjectId}/changes' => 'changes',
            '/threads/{subjectType}/{subjectId}/entries/{entryId}' => 'entries/'.$entryId,
            '/threads/{subjectType}/{subjectId}/entries/{entryId}/reactions' => 'entries/'.$entryId.'/reactions',
            default => throw new LogicException('No runner for '.$case->operation),
        });
        $body = match ($case->operation) {
            'POST /threads/{subjectType}/{subjectId}/entries' => ['id' => $this->ulid(), 'body' => 'actor writes'],
            'PATCH /threads/{subjectType}/{subjectId}/entries/{entryId}' => ['body' => 'edited'],
            'POST /threads/{subjectType}/{subjectId}/entries/{entryId}/reactions' => ['emoji' => '👍'],
            default => [],
        };
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, $uri, $body);

        if ($method === 'GET' || $case->outcome === Outcome::Allowed || $case->outcome === Outcome::Unauthenticated) {
            $response = $send();
            $this->assertRestOutcome($response, $case);
            if ($case->outcome === Outcome::Allowed && $case->operation === self::READ_OPS[0]) {
                $this->assertSame('owner comment', $response->json('list.0.body'), $case->key());
            }

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->threadSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     * @return array<string, mixed>
     */
    private function threadSnapshot(array $target): array
    {
        return [
            'rows' => ThreadIndex::query()->orderBy('uid')->get(['uid', 'modseq'])->toArray(),
            'thread' => $this->requestAsUsername($target['owner'], 'GET', $this->url($target['taskId'], 'entries'))->json('list'),
        ];
    }

    private function url(string $taskId, string $suffix): string
    {
        return '/threads/task/'.rawurlencode($taskId).'/'.$suffix;
    }

    private function ulid(): string
    {
        return self::ULID_PREFIX.str_pad(strtoupper(base_convert((string) ++$this->ulidCounter, 10, 32)), 4, '0', STR_PAD_LEFT);
    }
}
