<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Support\WgwSettings;
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

/**
 * Ownership matrix for the Tasks REST API (plan chunk-c-tasks).
 *
 * Each case seeds only the target its scope needs: one task list holding one
 * task, owned and shared as the scope describes. Sharees address a shared
 * list by their own copy id; invisible scopes use the owner's id, and revoked
 * or dismissed grants reuse the copy id the actor saw before.
 */
final class TasksOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    private const READ_OPS = [
        'GET /tasks/tasklists',
        'GET /tasks/tasklists/changes',
        'GET /tasks/tasklists/{taskListId}',
        'GET /tasks/items',
        'POST /tasks/items/query',
        'GET /tasks/items/{taskId}',
    ];

    private const ITEM_WRITE_OPS = [
        'POST /tasks/items',
        'PUT /tasks/items/{taskId}',
        'PATCH /tasks/items/{taskId}',
        'DELETE /tasks/items/{taskId}',
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

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
    }

    public static function ownershipCases(): array
    {
        $cases = [];
        $scopes = array_merge([Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup], self::grantScopes());

        foreach (Actor::signedIn() as $actor) {
            foreach ($scopes as $scope) {
                $visible = in_array($scope, self::VISIBLE, true);
                $readOnly = in_array($scope, self::READ_ONLY, true);
                $sharee = in_array($scope, self::SHAREE, true);

                foreach (self::READ_OPS as $op) {
                    $cases[] = OwnershipCase::of($op, $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound);
                }

                foreach (self::ITEM_WRITE_OPS as $op) {
                    $outcome = ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed);
                    $cases[] = OwnershipCase::of($op, $actor, $scope, $outcome);
                }

                $cases[] = OwnershipCase::of('PATCH /tasks/tasklists/{taskListId}', $actor, $scope, $visible ? Outcome::Allowed : Outcome::NotFound)
                    ->variant('rename');
                $cases[] = OwnershipCase::of(
                    'PATCH /tasks/tasklists/{taskListId}',
                    $actor,
                    $scope,
                    ! $visible ? Outcome::NotFound : ($sharee ? Outcome::Forbidden : Outcome::Allowed),
                )->variant('reshare');

                $cases[] = self::listDeleteCase($actor, $scope, $visible, $sharee);
            }

            foreach ([Scope::OwnUser, Scope::OwnGroup] as $scope) {
                $cases[] = OwnershipCase::of('POST /tasks/tasklists', $actor, $scope, Outcome::Allowed);
            }
            // The membership check answers 403 for every slug the caller is not
            // in, existing or not, so it reveals nothing (see unknown-group).
            foreach ([Scope::OtherGroup, Scope::FormerGroup] as $scope) {
                $cases[] = OwnershipCase::of('POST /tasks/tasklists', $actor, $scope, Outcome::Forbidden);
            }
            $cases[] = OwnershipCase::of('POST /tasks/tasklists', $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('unknown-group');

            // taskListIds in the body of an update must not move the actor's task:
            // PATCH refuses the field, PUT ignores it.
            $cases[] = OwnershipCase::of('PATCH /tasks/items/{taskId}', $actor, Scope::OtherUser, Outcome::Rejected)->variant('body-target');
            $cases[] = OwnershipCase::of('PUT /tasks/items/{taskId}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('body-target');
        }

        // Group membership is checked per request: leaving `crew` ends the access.
        $cases[] = OwnershipCase::of('GET /tasks/tasklists/{taskListId}', Actor::Member, Scope::UserToActorGroup, Outcome::NotFound)->variant('left-crew');

        foreach (array_merge(self::READ_OPS, self::ITEM_WRITE_OPS, [
            'PATCH /tasks/tasklists/{taskListId}',
            'DELETE /tasks/tasklists/{taskListId}',
            'POST /tasks/tasklists',
        ]) as $op) {
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

    private static function listDeleteCase(Actor $actor, Scope $scope, bool $visible, bool $sharee): OwnershipCase
    {
        $op = 'DELETE /tasks/tasklists/{taskListId}';
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

    private function runCase(OwnershipCase $case): void
    {
        if ($case->operation === 'POST /tasks/tasklists') {
            $this->runCreateList($case);

            return;
        }

        $target = $this->seedTarget($case->scope, $case->actor);
        if ($case->variant === 'left-crew') {
            $this->runLeftCrew($case, $target);

            return;
        }

        match ($case->operation) {
            'GET /tasks/tasklists' => $this->runListIndex($case, $target),
            'GET /tasks/tasklists/changes' => $this->runListChanges($case, $target),
            'GET /tasks/tasklists/{taskListId}' => $this->runListShow($case, $target),
            'PATCH /tasks/tasklists/{taskListId}' => $this->runListPatch($case, $target),
            'DELETE /tasks/tasklists/{taskListId}' => $this->runListDelete($case, $target),
            'GET /tasks/items' => $this->runItemIndex($case, $target),
            'POST /tasks/items/query' => $this->runItemQuery($case, $target),
            'GET /tasks/items/{taskId}' => $this->runItemShow($case, $target),
            'POST /tasks/items' => $this->runItemCreate($case, $target),
            'PUT /tasks/items/{taskId}', 'PATCH /tasks/items/{taskId}', 'DELETE /tasks/items/{taskId}' => $this->runItemWrite($case, $target),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runLeftCrew(OwnershipCase $case, array $target): void
    {
        $daveListId = $this->copyIdFor(OwnershipPrincipals::DAVE, $target['name']);
        $this->requestAs($case->actor, 'GET', '/tasks/tasklists/'.$target['actorListId'])->assertOk();

        $this->assertUnchanged(fn () => $this->ownerSnapshot($target), fn () => $this->leaveCrew($case->actor), $case->key());

        // Same token as before leaving.
        $this->assertRestOutcome($this->requestAs($case->actor, 'GET', '/tasks/tasklists/'.$target['actorListId']), $case);
        $ids = array_map('strval', array_column($this->listRows($this->requestAs($case->actor, 'GET', '/tasks/tasklists')), 'id'));
        $this->assertIdsAbsent([$target['actorListId'], $target['ownerListId']], $ids, $case->key());
        $this->requestAsUsername(OwnershipPrincipals::DAVE, 'GET', '/tasks/tasklists/'.$daveListId)->assertOk();
    }

    // ---- Target seeding -------------------------------------------------

    /**
     * @return array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}
     */
    private function seedTarget(Scope $scope, Actor $actor): array
    {
        $carol = OwnershipPrincipals::CAROL;
        $self = $actor === Actor::Anonymous ? null : $this->usernameFor($actor);
        $name = 'list '.$scope->value;

        [$owner, $groupSlug] = match ($scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, OwnershipPrincipals::OUTSIDERS],
            // The other actor creates it and stays in alumni, so the owner's
            // view still works after this actor leaves.
            Scope::FormerGroup => [$this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin), OwnershipPrincipals::ALUMNI],
            // Epic #1915: a Team share needs an owner in that Team; dave is in crew.
            Scope::UserToActorGroup => [OwnershipPrincipals::DAVE, null],
            default => [$carol, null],
        };
        if ($owner === null) {
            throw new LogicException($scope->value.' needs a signed-in actor.');
        }

        $ownerListId = $this->createList($owner, $name, $groupSlug);
        $taskId = $this->createTask($owner, $ownerListId, 'task '.$scope->value);
        $actorListId = $ownerListId;

        $grantee = $self ?? OwnershipPrincipals::MEMBER;
        switch ($scope) {
            case Scope::UserToActorRead:
            case Scope::GroupToNonmemberRead:
                $this->share($owner, $ownerListId, $grantee, write: false);
                $actorListId = $this->copyIdFor($grantee, $name);
                break;
            case Scope::UserToActorWrite:
            case Scope::GroupToNonmemberWrite:
                $this->share($owner, $ownerListId, $grantee, write: true);
                $actorListId = $this->copyIdFor($grantee, $name);
                break;
            case Scope::UserToActorGroup:
                $this->share($owner, $ownerListId, 'groups/'.OwnershipPrincipals::CREW, write: true);
                $actorListId = $this->copyIdFor($grantee, $name);
                break;
            case Scope::GrantRevoked:
                $this->share($owner, $ownerListId, $grantee, write: true);
                $actorListId = $this->copyIdFor($grantee, $name);
                $this->requestAsUsername($owner, 'PATCH', '/tasks/tasklists/'.$ownerListId, ['shareWith' => [$grantee => null]])->assertOk();
                break;
            case Scope::GrantDismissed:
                $this->share($owner, $ownerListId, $grantee, write: true);
                $actorListId = $this->copyIdFor($grantee, $name);
                $this->requestAsUsername($grantee, 'DELETE', '/tasks/tasklists/'.$actorListId)->assertOk();
                break;
            case Scope::FormerGroup:
                $this->leaveFormerGroup($actor);
                break;
            default:
                break;
        }

        return ['owner' => $owner, 'name' => $name, 'ownerListId' => $ownerListId, 'actorListId' => $actorListId, 'taskId' => $taskId];
    }

    private function createList(string $owner, string $name, ?string $groupSlug): string
    {
        $payload = ['name' => $name];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }

        return (string) $this->requestAsUsername($owner, 'POST', '/tasks/tasklists', $payload)->assertCreated()->json('id');
    }

    private function createTask(string $owner, string $listId, string $title): string
    {
        return (string) $this->requestAsUsername($owner, 'POST', '/tasks/items', [
            'taskListIds' => [$listId => true],
            'title' => $title,
        ])->assertCreated()->json('id');
    }

    private function share(string $owner, string $listId, string $grantee, bool $write): void
    {
        $rights = $write ? ['mayWriteAll' => true] : ['mayReadItems' => true];
        $this->requestAsUsername($owner, 'PATCH', '/tasks/tasklists/'.$listId, ['shareWith' => [$grantee => $rights]])->assertOk();
    }

    private function etagOf(string $owner, string $taskId): string
    {
        $etag = $this->requestAsUsername($owner, 'GET', '/tasks/items/'.$taskId)->assertOk()->headers->get('ETag');
        $this->assertIsString($etag);

        return $etag;
    }

    private function copyIdFor(string $username, string $name): string
    {
        foreach ($this->listRows($this->requestAsUsername($username, 'GET', '/tasks/tasklists')) as $row) {
            if (($row['name'] ?? null) === $name) {
                return (string) $row['id'];
            }
        }

        $this->fail($username.' does not see shared list '.$name);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function listRows(TestResponse $response): array
    {
        $response->assertOk();
        $rows = $response->json('list');

        return is_array($rows) ? array_values($rows) : [];
    }

    /**
     * The owner's view of the target, for proving a denied write changed nothing.
     *
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target): array
    {
        $list = $this->requestAsUsername($target['owner'], 'GET', '/tasks/tasklists/'.$target['ownerListId']);
        $task = $this->requestAsUsername($target['owner'], 'GET', '/tasks/items/'.$target['taskId']);
        $items = $this->requestAsUsername($target['owner'], 'GET', '/tasks/items?taskListId='.urlencode($target['ownerListId']));

        return [
            'listStatus' => $list->getStatusCode(),
            'listName' => $list->json('name'),
            'shareWith' => $list->json('shareWith'),
            'taskStatus' => $task->getStatusCode(),
            'taskTitle' => $task->json('title'),
            'itemIds' => $this->itemIds($items),
        ];
    }

    /**
     * @return list<string>
     */
    private function itemIds(TestResponse $response): array
    {
        $rows = $response->json('list') ?? $response->json('ids') ?? [];
        if (! is_array($rows)) {
            return [];
        }
        $ids = array_map(static fn (mixed $row): string => is_array($row) ? (string) ($row['id'] ?? '') : (string) $row, $rows);
        sort($ids);

        return $ids;
    }

    // ---- Runners ---------------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runListIndex(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/tasks/tasklists');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $rows = $this->listRows($response);
        $names = array_column($rows, 'name');
        $ids = array_map('strval', array_column($rows, 'id'));

        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['name'], $names, $case->key());

            return;
        }
        $this->assertNotContains($target['name'], $names, $case->key());
        $this->assertIdsAbsent([$target['ownerListId'], $target['actorListId']], $ids, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runListChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/tasks/tasklists/changes');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response->assertOk();
        $created = array_map('strval', (array) $response->json('created'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorListId'], $created, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['ownerListId'], $target['actorListId']], $created, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runListShow(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/tasks/tasklists/'.$target['actorListId']);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['name'], $response->json('name'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runListPatch(OwnershipCase $case, array $target): void
    {
        $body = $case->variant === 'reshare'
            ? ['shareWith' => [OwnershipPrincipals::DAVE => ['mayReadItems' => true]]]
            : ['name' => 'renamed by actor'];
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/tasks/tasklists/'.$target['actorListId'], $body);

        if ($case->outcome === Outcome::Allowed && $case->variant === 'rename' && in_array($case->scope, self::SHAREE, true)) {
            // A sharee renames only its own copy; the owner's list keeps its name.
            $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target)['listName'], $send, $case->key());
            $this->assertRestOutcome($response, $case);

            return;
        }
        if ($case->outcome === Outcome::Allowed || $case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runListDelete(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/tasks/tasklists/'.$target['actorListId'], ['onDestroyRemoveContents' => true]);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            $this->assertSame(404, $this->ownerSnapshot($target)['listStatus'], $case->key().': list still exists after delete.');

            return;
        }
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        // Denied and dismissed both leave the owner's list and task in place.
        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Dismissed) {
            $names = array_column($this->listRows($this->requestAs($case->actor, 'GET', '/tasks/tasklists')), 'name');
            $this->assertNotContains($target['name'], $names, $case->key().': dismissed list still listed for the actor.');
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runItemIndex(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/tasks/items?taskListId='.urlencode($target['actorListId']));
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['taskId'], $this->itemIds($response), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runItemQuery(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'POST', '/tasks/items/query', ['filter' => ['inTaskList' => $target['actorListId']]]);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['taskId'], $this->itemIds($response), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runItemShow(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/tasks/items/'.$target['taskId']);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('task '.$case->scope->value, $response->json('title'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runItemCreate(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/tasks/items', [
            'taskListIds' => [$target['actorListId'] => true],
            'title' => 'created by actor',
        ]);

        if ($case->outcome === Outcome::Allowed || $case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * PUT, PATCH, and DELETE on the target task.
     *
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $target
     */
    private function runItemWrite(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'body-target') {
            $this->runBodyTarget($case, $target);

            return;
        }

        [$method] = explode(' ', $case->operation, 2);
        $body = match ($method) {
            'PUT' => ['taskListIds' => [$target['actorListId'] => true], 'title' => 'replaced by actor'],
            'PATCH' => ['title' => 'patched by actor'],
            default => [],
        };
        // The owner's current ETag: the strongest precondition another client could send.
        $headers = ['If-Match' => $this->etagOf($target['owner'], $target['taskId'])];
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, '/tasks/items/'.$target['taskId'], $body, $headers);

        if ($case->outcome === Outcome::Allowed || $case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
    }

    /**
     * The actor updates its own task and names another user's list in the
     * body. PUT moves a task to the list it names, so it is denied as not
     * found; PATCH rejects the field. Either way the task stays in the
     * actor's list and the other list gains nothing.
     *
     * @param  array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}  $foreign
     */
    private function runBodyTarget(OwnershipCase $case, array $foreign): void
    {
        $self = $this->usernameFor($case->actor);
        $ownListId = $this->createList($self, 'own list for body-target', null);
        $ownTaskId = $this->createTask($self, $ownListId, 'own task');
        [$method] = explode(' ', $case->operation, 2);

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($foreign),
            fn (): TestResponse => $this->requestAs($case->actor, $method, '/tasks/items/'.$ownTaskId, [
                'taskListIds' => [$foreign['ownerListId'] => true],
                'title' => 'moved?',
            ], ['If-Match' => $this->etagOf($self, $ownTaskId)]),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);

        $ownItems = $this->itemIds($this->requestAs($case->actor, 'GET', '/tasks/items?taskListId='.urlencode($ownListId)));
        $this->assertContains($ownTaskId, $ownItems, $case->key().': task left the actor list.');
    }

    private function runCreateList(OwnershipCase $case): void
    {
        $groupSlug = match ($case->scope) {
            Scope::OwnUser => null,
            Scope::OwnGroup => OwnershipPrincipals::CREW,
            Scope::OtherGroup => OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => OwnershipPrincipals::ALUMNI,
            Scope::OtherUser => OwnershipPrincipals::OUTSIDERS,
            default => throw new LogicException('No create-list target for '.$case->scope->value),
        };
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $payload = ['name' => 'created in '.$case->scope->value];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }
        $response = $this->requestAs($case->actor, 'POST', '/tasks/tasklists', $payload);
        $this->assertRestOutcome($response, $case);

        if ($case->variant === 'unknown-group') {
            $unknown = $this->requestAs($case->actor, 'POST', '/tasks/tasklists', ['name' => $payload['name'], 'groupSlug' => 'no-such-group']);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');
        }

        if ($case->outcome !== Outcome::Allowed) {
            // Read the group's lists as a principal that is still in it.
            $groupMember = $case->scope === Scope::FormerGroup
                ? $this->usernameFor($case->actor === Actor::Member ? Actor::Admin : Actor::Member)
                : OwnershipPrincipals::CAROL;
            $groupNames = array_column($this->listRows($this->requestAsUsername($groupMember, 'GET', '/tasks/tasklists')), 'name');
            $this->assertNotContains($payload['name'], $groupNames, $case->key().': list created in a group the actor is not in.');
        }
    }
}
