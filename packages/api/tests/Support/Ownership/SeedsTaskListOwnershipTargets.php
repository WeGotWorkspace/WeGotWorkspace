<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\Support\WgwDatabaseTestCase;

/**
 * One task list and one task per ownership scope, seen from the actor
 * (TasksOwnershipTest; TaskThreadsOwnershipTest for the threads on it, #2173).
 *
 * @phpstan-require-extends WgwDatabaseTestCase
 */
trait SeedsTaskListOwnershipTargets
{
    /**
     * @return array{owner: string, name: string, ownerListId: string, actorListId: string, taskId: string}
     */
    protected function seedTarget(Scope $scope, Actor $actor): array
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

    protected function createList(string $owner, string $name, ?string $groupSlug): string
    {
        $payload = ['name' => $name];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }

        return (string) $this->requestAsUsername($owner, 'POST', '/tasks/tasklists', $payload)->assertCreated()->json('id');
    }

    protected function createTask(string $owner, string $listId, string $title): string
    {
        return (string) $this->requestAsUsername($owner, 'POST', '/tasks/items', [
            'taskListIds' => [$listId => true],
            'title' => $title,
        ])->assertCreated()->json('id');
    }

    protected function share(string $owner, string $listId, string $grantee, bool $write): void
    {
        $rights = $write ? ['mayWriteAll' => true] : ['mayReadItems' => true];
        $this->requestAsUsername($owner, 'PATCH', '/tasks/tasklists/'.$listId, ['shareWith' => [$grantee => $rights]])->assertOk();
    }

    protected function copyIdFor(string $username, string $name): string
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
    protected function listRows(TestResponse $response): array
    {
        $response->assertOk();
        $rows = $response->json('list');

        return is_array($rows) ? array_values($rows) : [];
    }
}
