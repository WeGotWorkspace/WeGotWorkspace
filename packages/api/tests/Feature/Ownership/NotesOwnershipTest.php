<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Services\Calendars\CalendarCollectionUris;
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
use Tests\Support\Ownership\OwnershipSuite;
use Tests\Support\Ownership\OwnershipWorld;
use Tests\Support\Ownership\Scope;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Ownership matrix for Notes: REST notes/notebooks/* and notes/items/*, and
 * JMAP Notebook/* and Note/* (plan chunk-d-notes).
 *
 * Each case seeds one notebook holding one note, owned and shared as the
 * scope describes. Sharees address a shared notebook by their own copy id;
 * invisible scopes use the owner's id, and revoked or dismissed grants reuse
 * the copy id the actor saw before. Note ids are global UIDs, so every scope
 * addresses the note by the same id.
 *
 * `member` runs every scope. Notes code has one admin rule, the admin-only
 * delete of a group notebook, so `admin` runs that and one invisible scope
 * per operation (another group's notebook) to prove it gets no other right.
 */
final class NotesOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;
    use SendsFramedCollaboration;

    private const USING = [JmapCapabilities::CORE, JmapCapabilities::NOTES];

    private const REST_READ_OPS = [
        'GET /notes/notebooks',
        'GET /notes/notebooks/changes',
        'GET /notes/notebooks/{notebookId}',
        'GET /notes/items',
        'GET /notes/items/changes',
        'GET /notes/items/{noteId}',
    ];

    private const JMAP_READ_OPS = [
        'JMAP Notebook/get',
        'JMAP Notebook/changes',
        'JMAP Note/get',
        'JMAP Note/changes',
        'JMAP Note/query',
    ];

    private const REST_ITEM_WRITE_OPS = [
        'POST /notes/items',
        'PATCH /notes/items/{noteId}',
        'PUT /notes/items/{noteId}',
        'DELETE /notes/items/{noteId}',
    ];

    private const STAR_OPS = [
        'POST /notes/items/{noteId}/star',
        'DELETE /notes/items/{noteId}/star',
    ];

    private const NOTEBOOK_ONLY_OPS = [
        'GET /notes/notebooks',
        'GET /notes/notebooks/changes',
        'GET /notes/notebooks/{notebookId}',
        'PATCH /notes/notebooks/{notebookId}',
        'JMAP Notebook/get',
        'JMAP Notebook/changes',
    ];

    /** Operations whose seed captures the actor's sync state while the target is still visible. */
    private const CHANGES_OPS = [
        'GET /notes/notebooks/changes',
        'JMAP Notebook/changes',
        'JMAP Note/changes',
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

    private const REST_ONLY_SCOPES = [Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite, Scope::UserToActorGroup];

    /** Operations `admin` runs against another group's notebook. */
    private const ADMIN_OPS = [
        'GET /notes/notebooks',
        'GET /notes/notebooks/{notebookId}',
        'PATCH /notes/notebooks/{notebookId}',
        'DELETE /notes/notebooks/{notebookId}',
        'GET /notes/items',
        'GET /notes/items/{noteId}',
        'POST /notes/items',
        'PATCH /notes/items/{noteId}',
        'PUT /notes/items/{noteId}',
        'DELETE /notes/items/{noteId}',
        'POST /notes/items/{noteId}/star',
        'JMAP Notebook/get',
        'JMAP Notebook/set',
        'JMAP Note/get',
        'JMAP Note/query',
        'JMAP Note/set',
    ];

    /** Scopes where the actor saw the target before losing it. */
    private const LOSS = [Scope::FormerGroup, Scope::GrantRevoked, Scope::GrantDismissed];

    /** Destinations for a note the actor moves out of its own notebook. */
    private const MOVE_TARGETS = [
        Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup,
        Scope::UserToActorRead, Scope::GrantRevoked, Scope::GrantDismissed,
        Scope::UserToActorWrite,
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedOwnershipWorld();
    }

    public static function ownershipCases(): array
    {
        $cases = [];

        foreach (self::allScopes() as $scope) {
            array_push($cases, ...self::scopeCases(Actor::Member, $scope));
        }
        array_push($cases, ...self::targetCases(Actor::Member));

        foreach (self::scopeCases(Actor::Admin, Scope::OtherGroup) as $case) {
            if (in_array($case->operation, self::ADMIN_OPS, true)) {
                $cases[] = $case;
            }
        }
        foreach (self::scopeCases(Actor::Admin, Scope::OwnGroup) as $case) {
            if (in_array($case->operation, ['DELETE /notes/notebooks/{notebookId}', 'JMAP Notebook/set'], true) && $case->variant !== 'update') {
                $cases[] = $case;
            }
        }
        $cases[] = OwnershipCase::of('POST /notes/notebooks', Actor::Admin, Scope::OtherGroup, Outcome::Forbidden);
        $cases[] = OwnershipCase::of('PATCH /notes/notebooks/{notebookId}', Actor::Admin, Scope::OwnGroup, Outcome::Allowed)->variant('take-personal');
        $cases[] = OwnershipCase::of('POST /notes/items', Actor::Admin, Scope::OtherGroup, Outcome::NotFound)->variant('group-default');
        foreach (['PATCH /notes/items/{noteId}', 'JMAP Note/set'] as $op) {
            $cases[] = OwnershipCase::of($op, Actor::Admin, Scope::OtherGroup, Outcome::NotFound)->variant('move-in');
        }

        foreach (array_merge(self::REST_READ_OPS, self::REST_ITEM_WRITE_OPS, self::STAR_OPS, [
            'PATCH /notes/notebooks/{notebookId}',
            'DELETE /notes/notebooks/{notebookId}',
            'POST /notes/notebooks',
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

    // ---- Declarations ----------------------------------------------------

    /**
     * @return list<Scope>
     */
    private static function allScopes(): array
    {
        return [
            Scope::OwnUser, Scope::OwnGroup, Scope::OtherUser, Scope::OtherGroup, Scope::FormerGroup,
            Scope::UserToActorRead, Scope::UserToActorWrite,
            Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite,
            Scope::UserToActorGroup, Scope::GrantRevoked, Scope::GrantDismissed,
        ];
    }

    /**
     * @return list<OwnershipCase>
     */
    private static function scopeCases(Actor $actor, Scope $scope): array
    {
        $visible = in_array($scope, self::VISIBLE, true);
        $readOnly = in_array($scope, self::READ_ONLY, true);
        $sharee = in_array($scope, self::SHAREE, true);
        $read = $visible ? Outcome::Allowed : Outcome::NotFound;
        $write = ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed);
        // JMAP methods call the same lookups as the REST rows. They skip the
        // grant scopes whose sharee copy is built exactly like user-to-actor-*.
        $jmap = ! in_array($scope, self::REST_ONLY_SCOPES, true);
        $cases = [];

        foreach (array_merge(self::REST_READ_OPS, $jmap ? self::JMAP_READ_OPS : [], self::STAR_OPS) as $op) {
            $cases[] = OwnershipCase::of($op, $actor, $scope, $read);
        }
        foreach (self::REST_ITEM_WRITE_OPS as $op) {
            $cases[] = OwnershipCase::of($op, $actor, $scope, $write);
        }
        if ($jmap) {
            // One Note/set call that creates in the notebook, then updates and destroys the note.
            $cases[] = OwnershipCase::of('JMAP Note/set', $actor, $scope, $write);
        }

        // A sharee renames only its own copy of the notebook.
        $cases[] = OwnershipCase::of('PATCH /notes/notebooks/{notebookId}', $actor, $scope, $read)->variant('rename');
        if ($jmap) {
            $cases[] = OwnershipCase::of('JMAP Notebook/set', $actor, $scope, $read)->variant('update');
        }
        if ($visible) {
            $cases[] = OwnershipCase::of('PATCH /notes/notebooks/{notebookId}', $actor, $scope, $sharee ? Outcome::Forbidden : Outcome::Allowed)
                ->variant('reshare');
        }

        $delete = self::notebookDeleteOutcome($actor, $scope, $visible, $sharee);
        $cases[] = $delete === Outcome::Forbidden
            ? OwnershipCase::of('DELETE /notes/notebooks/{notebookId}', $actor, $scope, $delete)->withCode('group_delete_admin_only')
            : OwnershipCase::of('DELETE /notes/notebooks/{notebookId}', $actor, $scope, $delete);
        if ($jmap) {
            $cases[] = OwnershipCase::of('JMAP Notebook/set', $actor, $scope, $delete)->variant('destroy');
        }

        return $cases;
    }

    /**
     * Cases whose target is named in the body or in the account, not in the scope's seed alone.
     *
     * @return list<OwnershipCase>
     */
    private static function targetCases(Actor $actor): array
    {
        $cases = [];

        foreach ([Scope::OwnUser, Scope::OwnGroup] as $scope) {
            $cases[] = OwnershipCase::of('POST /notes/notebooks', $actor, $scope, Outcome::Allowed);
        }
        // The membership check answers 403 for every slug the caller is not
        // in, existing or not, so it reveals nothing (see unknown-group).
        foreach ([Scope::OtherGroup, Scope::FormerGroup] as $scope) {
            $cases[] = OwnershipCase::of('POST /notes/notebooks', $actor, $scope, Outcome::Forbidden);
        }
        $cases[] = OwnershipCase::of('POST /notes/notebooks', $actor, Scope::OtherGroup, Outcome::Forbidden)->variant('unknown-group');

        // The actor moves its own note into the scope's notebook.
        foreach (self::MOVE_TARGETS as $scope) {
            $outcome = match (true) {
                in_array($scope, self::READ_ONLY, true) => Outcome::Forbidden,
                in_array($scope, self::VISIBLE, true) => Outcome::Allowed,
                default => Outcome::NotFound,
            };
            $cases[] = OwnershipCase::of('PATCH /notes/items/{noteId}', $actor, $scope, $outcome)->variant('move-in');
            $cases[] = OwnershipCase::of('JMAP Note/set', $actor, $scope, $outcome)->variant('move-in');
        }

        // The provisioned group notebook has a predictable id.
        $cases[] = OwnershipCase::of('GET /notes/notebooks/{notebookId}', $actor, Scope::OtherGroup, Outcome::NotFound)->variant('group-default');
        $cases[] = OwnershipCase::of('POST /notes/items', $actor, Scope::OtherGroup, Outcome::NotFound)->variant('group-default');
        $cases[] = OwnershipCase::of('POST /notes/items', $actor, Scope::FormerGroup, Outcome::NotFound)->variant('group-default');

        // A note the actor starred while it could see it.
        $cases[] = OwnershipCase::of('GET /notes/items', $actor, Scope::UserToActorRead, Outcome::Allowed)->variant('starred');
        foreach (self::LOSS as $scope) {
            $cases[] = OwnershipCase::of('GET /notes/items', $actor, $scope, Outcome::NotFound)->variant('starred');
        }

        // A create in the actor's own notebook that names another user's note UID.
        $cases[] = OwnershipCase::of('POST /notes/items', $actor, Scope::OtherUser, Outcome::Allowed)->variant('foreign-uid');

        // The Yjs state read and the JMAP get-all path find notes their own way.
        $cases[] = OwnershipCase::of('GET /notes/items/{noteId}', $actor, Scope::OtherUser, Outcome::NotFound)->variant('yjs');
        $cases[] = OwnershipCase::of('GET /notes/items/{noteId}', $actor, Scope::UserToActorRead, Outcome::Allowed)->variant('yjs');
        $cases[] = OwnershipCase::of('JMAP Note/get', $actor, Scope::OtherUser, Outcome::NotFound)->variant('all');
        $cases[] = OwnershipCase::of('JMAP Note/get', $actor, Scope::GrantDismissed, Outcome::NotFound)->variant('all');

        // groupSlug in a notebook PATCH names a new owner. Taking a group
        // notebook out of the group removes it like a delete does.
        $cases[] = OwnershipCase::of('PATCH /notes/notebooks/{notebookId}', $actor, Scope::OwnGroup, Outcome::Forbidden)
            ->withCode('group_delete_admin_only')->variant('take-personal');
        // The actor's own notebook handed to a group it is not in. The
        // membership check answers like an unknown group.
        foreach ([Scope::OtherGroup, Scope::FormerGroup] as $scope) {
            $cases[] = OwnershipCase::of('PATCH /notes/notebooks/{notebookId}', $actor, $scope, Outcome::Forbidden)->variant('transfer-in');
        }

        foreach (['JMAP Notebook/get', 'JMAP Notebook/changes', 'JMAP Notebook/set', 'JMAP Note/get', 'JMAP Note/changes', 'JMAP Note/set', 'JMAP Note/query', 'JMAP Note/queryChanges'] as $op) {
            $cases[] = OwnershipCase::of($op, $actor, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }
        // Note/queryChanges has no per-object answer: it refuses every query the same way.
        $cases[] = OwnershipCase::of('JMAP Note/queryChanges', $actor, Scope::OtherUser, Outcome::NotFound)->variant('cannot-calculate');

        return $cases;
    }

    private static function notebookDeleteOutcome(Actor $actor, Scope $scope, bool $visible, bool $sharee): Outcome
    {
        return match (true) {
            ! $visible => Outcome::NotFound,
            $sharee => Outcome::Dismissed,
            $scope === Scope::OwnGroup && $actor === Actor::Member => Outcome::Forbidden,
            default => Outcome::Allowed,
        };
    }

    // ---- Dispatch --------------------------------------------------------

    private function runCase(OwnershipCase $case): void
    {
        switch ($case->variant) {
            case 'foreign-account':
                $this->runForeignAccount($case);

                return;
            case 'cannot-calculate':
                $this->runQueryChanges($case);

                return;
            case 'group-default':
                $this->runGroupDefault($case);

                return;
            case 'unknown-group':
                $this->runCreateNotebook($case);

                return;
            case 'transfer-in':
                $this->runTransferIn($case);

                return;
        }
        if ($case->operation === 'POST /notes/notebooks') {
            $this->runCreateNotebook($case);

            return;
        }

        $target = $this->seedTarget($case);

        match ($case->operation) {
            'GET /notes/notebooks' => $this->runNotebookIndex($case, $target),
            'GET /notes/notebooks/changes' => $this->runNotebookChanges($case, $target),
            'GET /notes/notebooks/{notebookId}' => $this->runNotebookShow($case, $target),
            'PATCH /notes/notebooks/{notebookId}' => $this->runNotebookPatch($case, $target),
            'DELETE /notes/notebooks/{notebookId}' => $this->runNotebookDelete($case, $target),
            'GET /notes/items' => $this->runNoteIndex($case, $target),
            'GET /notes/items/changes' => $this->runNoteChanges($case, $target),
            'GET /notes/items/{noteId}' => $this->runNoteShow($case, $target),
            'POST /notes/items' => $this->runNoteCreate($case, $target),
            'PATCH /notes/items/{noteId}', 'PUT /notes/items/{noteId}', 'DELETE /notes/items/{noteId}' => $this->runNoteWrite($case, $target),
            'POST /notes/items/{noteId}/star', 'DELETE /notes/items/{noteId}/star' => $this->runStar($case, $target),
            'JMAP Notebook/get' => $this->runJmapNotebookGet($case, $target),
            'JMAP Notebook/changes', 'JMAP Note/changes' => $this->runJmapChanges($case, $target),
            'JMAP Notebook/set' => $this->runJmapNotebookSet($case, $target),
            'JMAP Note/get' => $this->runJmapNoteGet($case, $target),
            'JMAP Note/query' => $this->runJmapNoteQuery($case, $target),
            'JMAP Note/set' => $this->runJmapNoteSet($case, $target),
            default => throw new LogicException('No runner for '.$case->key()),
        };
    }

    // ---- Target seeding -------------------------------------------------

    /**
     * @return array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}
     */
    private function seedTarget(OwnershipCase $case): array
    {
        $scope = $case->scope;
        $actor = $case->actor;
        $carol = OwnershipPrincipals::CAROL;
        $self = $actor === Actor::Anonymous ? null : $this->usernameFor($actor);
        $name = 'nb '.$scope->value;

        [$owner, $groupSlug] = match ($scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, OwnershipPrincipals::OUTSIDERS],
            // The other actor creates it and stays in alumni, so the owner's
            // view still works after this actor leaves.
            Scope::FormerGroup => [$this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin), OwnershipPrincipals::ALUMNI],
            default => [$carol, null],
        };
        if ($owner === null) {
            throw new LogicException($scope->value.' needs a signed-in actor.');
        }

        $ownerNotebookId = $this->createNotebook($owner, $name, $groupSlug);
        $target = [
            'owner' => $owner,
            'name' => $name,
            'ownerNotebookId' => $ownerNotebookId,
            'actorNotebookId' => $ownerNotebookId,
            'noteId' => '',
            'etag' => '',
            'since' => null,
        ];
        if (self::needsNote($case)) {
            [$target['noteId'], $target['etag']] = $this->createNote($owner, $ownerNotebookId, 'note '.$scope->value);
        }

        $grantee = $self ?? OwnershipPrincipals::MEMBER;
        switch ($scope) {
            case Scope::UserToActorRead:
            case Scope::GroupToNonmemberRead:
                $this->share($owner, $ownerNotebookId, $grantee, write: false);
                $target['actorNotebookId'] = $this->copyIdFor($grantee, $name);
                break;
            case Scope::UserToActorWrite:
            case Scope::GroupToNonmemberWrite:
                $this->share($owner, $ownerNotebookId, $grantee, write: true);
                $target['actorNotebookId'] = $this->copyIdFor($grantee, $name);
                break;
            case Scope::UserToActorGroup:
                $this->share($owner, $ownerNotebookId, 'groups/'.OwnershipPrincipals::CREW, write: true);
                $target['actorNotebookId'] = $this->copyIdFor($grantee, $name);
                break;
            case Scope::GrantRevoked:
                $this->share($owner, $ownerNotebookId, $grantee, write: true);
                $target['actorNotebookId'] = $this->copyIdFor($grantee, $name);
                $target = $this->beforeLoss($case, $target);
                $this->requestAsUsername($owner, 'PATCH', '/notes/notebooks/'.$ownerNotebookId, ['shareWith' => [$grantee => null]])->assertOk();
                break;
            case Scope::GrantDismissed:
                $this->share($owner, $ownerNotebookId, $grantee, write: true);
                $target['actorNotebookId'] = $this->copyIdFor($grantee, $name);
                $target = $this->beforeLoss($case, $target);
                $this->requestAsUsername($grantee, 'DELETE', '/notes/notebooks/'.$target['actorNotebookId'])->assertOk();
                break;
            case Scope::FormerGroup:
                $target = $this->beforeLoss($case, $target);
                $this->leaveFormerGroup($actor);
                break;
            default:
                break;
        }

        return $target;
    }

    /**
     * Notebook-level cases and creates into the notebook need no note in it.
     */
    private static function needsNote(OwnershipCase $case): bool
    {
        if (in_array($case->operation, self::NOTEBOOK_ONLY_OPS, true) || $case->variant === 'move-in') {
            return false;
        }
        if ($case->operation === 'JMAP Notebook/set') {
            return $case->variant !== 'update';
        }

        return $case->operation !== 'POST /notes/items' || $case->variant === 'foreign-uid';
    }

    /**
     * Steps the actor takes while it still sees the target: remember a sync
     * state, or star the note.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @return array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}
     */
    private function beforeLoss(OwnershipCase $case, array $target): array
    {
        if ($case->actor === Actor::Anonymous) {
            return $target;
        }
        if ($case->operation === 'GET /notes/notebooks/changes') {
            $target['since'] = (string) $this->requestAs($case->actor, 'GET', '/notes/notebooks/changes')->assertOk()->json('newState');
        } elseif (in_array($case->operation, self::CHANGES_OPS, true)) {
            $method = $case->operation === 'JMAP Note/changes' ? 'Note/get' : 'Notebook/get';
            $target['since'] = (string) $this->jmap($case->actor, $method, ['ids' => []])->assertOk()->json('methodResponses.0.1.state');
        }
        if ($case->operation === 'DELETE /notes/items/{noteId}/star' || $case->variant === 'starred') {
            $this->requestAs($case->actor, 'POST', '/notes/items/'.$target['noteId'].'/star')->assertOk();
        }

        return $target;
    }

    private function createNotebook(string $owner, string $name, ?string $groupSlug): string
    {
        $payload = ['name' => $name];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }

        return (string) $this->requestAsUsername($owner, 'POST', '/notes/notebooks', $payload)->assertCreated()->json('id');
    }

    /**
     * @return array{0: string, 1: string} note id and its ETag
     */
    private function createNote(string $owner, string $notebookId, string $title): array
    {
        $created = $this->requestAsUsername($owner, 'POST', '/notes/items', [
            'notebookId' => $notebookId,
            'title' => $title,
            'body' => 'body of '.$title,
        ])->assertCreated();

        return [(string) $created->json('id'), (string) $created->json('etag')];
    }

    private function share(string $owner, string $notebookId, string $grantee, bool $write): void
    {
        $rights = $write ? ['mayWriteAll' => true] : ['mayReadItems' => true];
        $this->requestAsUsername($owner, 'PATCH', '/notes/notebooks/'.$notebookId, ['shareWith' => [$grantee => $rights]])->assertOk();
    }

    private function copyIdFor(string $username, string $name): string
    {
        foreach ($this->listRows($this->requestAsUsername($username, 'GET', '/notes/notebooks')) as $row) {
            if (($row['name'] ?? null) === $name) {
                return (string) $row['id'];
            }
        }

        $this->fail($username.' does not see shared notebook '.$name);
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
     * @return list<string>
     */
    private function rowIds(TestResponse $response): array
    {
        $ids = array_map('strval', array_column($this->listRows($response), 'id'));
        sort($ids);

        return $ids;
    }

    /**
     * The owner's view of the target, for proving a denied write changed
     * nothing: the notebook, and the notes in it with their fields.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target, bool $withState = false): array
    {
        $owner = $target['owner'];
        $notebook = $this->requestAsUsername($owner, 'GET', '/notes/notebooks/'.$target['ownerNotebookId']);
        $items = $this->requestAsUsername($owner, 'GET', '/notes/items?notebookId='.urlencode($target['ownerNotebookId']));
        $notes = [];
        if ($items->getStatusCode() === 200) {
            foreach ($this->listRows($items) as $row) {
                $notes[(string) $row['id']] = [$row['title'] ?? null, $row['body'] ?? null, $row['etag'] ?? null, $row['starred'] ?? null];
            }
            ksort($notes);
        }

        $snapshot = [
            'notebook' => $notebook->getStatusCode() === 200 ? [$notebook->json('name'), $notebook->json('shareWith')] : null,
            'notes' => $notes,
        ];
        if ($withState) {
            $snapshot['stateStatus'] = $this->requestAsUsername($owner, 'GET', '/notes/items/'.$target['noteId'].'?format=yjs')->getStatusCode();
        }

        return $snapshot;
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @return list<string>
     */
    private function ownerNoteIds(array $target): array
    {
        return array_keys($this->ownerSnapshot($target)['notes']);
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @return array{0: mixed, 1: mixed, 2: mixed, 3: mixed}|null title, body, etag, starred
     */
    private function ownerNote(array $target): ?array
    {
        return $this->ownerSnapshot($target)['notes'][$target['noteId']] ?? null;
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function jmap(Actor $actor, string $method, array $args, ?string $accountId = null): TestResponse
    {
        return $this->jmapAs($actor, [[$method, ['accountId' => $accountId ?? $this->accountIdFor($actor)] + $args, 'c0']], self::USING);
    }

    /**
     * A hidden target must answer exactly like a target that never existed.
     */
    private function assertSameAsMissing(TestResponse $response, callable $sendForMissing, OwnershipCase $case): void
    {
        /** @var TestResponse $missing */
        $missing = $sendForMissing();
        $this->assertSame($missing->getStatusCode(), $response->getStatusCode(), $case->key().': hidden and missing targets differ.');
        $this->assertSame($missing->json(), $response->json(), $case->key().': hidden and missing targets differ.');
    }

    // ---- REST notebooks ---------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNotebookIndex(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/notes/notebooks');
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $rows = $this->listRows($response);
        $names = array_column($rows, 'name');
        $ids = array_map('strval', array_column($rows, 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorNotebookId'], $ids, $case->key());

            return;
        }
        $this->assertNotContains($target['name'], $names, $case->key());
        $this->assertIdsAbsent([$target['ownerNotebookId'], $target['actorNotebookId']], $ids, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNotebookChanges(OwnershipCase $case, array $target): void
    {
        $query = $target['since'] === null ? '' : '?since='.urlencode($target['since']);
        $response = $this->requestAs($case->actor, 'GET', '/notes/notebooks/changes'.$query);
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($response, $case);

            return;
        }

        $response->assertOk();
        $created = array_map('strval', (array) $response->json('created'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorNotebookId'], $created, $case->key());

            return;
        }
        $listed = array_merge($created, array_map('strval', (array) $response->json('updated')));
        $this->assertIdsAbsent([$target['ownerNotebookId'], $target['actorNotebookId']], $listed, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNotebookShow(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/notes/notebooks/'.$target['actorNotebookId']);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame($target['name'], $response->json('name'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNotebookPatch(OwnershipCase $case, array $target): void
    {
        $body = match ($case->variant) {
            'reshare' => ['shareWith' => [OwnershipPrincipals::DAVE => ['mayReadItems' => true]]],
            'take-personal' => ['groupSlug' => null],
            default => ['name' => 'renamed by actor'],
        };
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/notes/notebooks/'.$target['actorNotebookId'], $body);

        $this->assertNotebookWrite($case, $target, $send, fn (TestResponse $response) => $this->assertRestOutcome($response, $case));
    }

    /**
     * Shared by REST PATCH and JMAP Notebook/set update.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @param  callable(): TestResponse  $send
     * @param  callable(TestResponse): void  $assertOutcome
     */
    private function assertNotebookWrite(OwnershipCase $case, array $target, callable $send, callable $assertOutcome): void
    {
        $renameAsSharee = in_array($case->variant, ['rename', 'update'], true) && in_array($case->scope, self::SHAREE, true);
        if ($case->outcome === Outcome::Allowed && $renameAsSharee) {
            // A sharee renames only its own copy; the owner's notebook keeps its name.
            $assertOutcome($this->assertUnchanged(fn () => $this->ownerSnapshot($target)['notebook'], $send, $case->key()));

            return;
        }
        if ($case->outcome === Outcome::Allowed || $case->outcome === Outcome::Unauthenticated) {
            $assertOutcome($send());

            return;
        }

        $assertOutcome($this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key()));
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNotebookDelete(OwnershipCase $case, array $target): void
    {
        $send = fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', '/notes/notebooks/'.$target['actorNotebookId'], ['onDestroyRemoveContents' => true]);

        $this->assertNotebookDelete($case, $target, $send, fn (TestResponse $response) => $this->assertRestOutcome($response, $case));
    }

    /**
     * Shared by REST DELETE and JMAP Notebook/set destroy.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     * @param  callable(): TestResponse  $send
     * @param  callable(TestResponse): void  $assertOutcome
     */
    private function assertNotebookDelete(OwnershipCase $case, array $target, callable $send, callable $assertOutcome): void
    {
        if ($case->outcome === Outcome::Allowed) {
            $assertOutcome($send());
            $this->assertNull($this->ownerSnapshot($target)['notebook'], $case->key().': notebook still exists after delete.');

            return;
        }
        if ($case->outcome === Outcome::Unauthenticated) {
            $assertOutcome($send());

            return;
        }

        // Denied and dismissed both leave the owner's notebook and note in place.
        $assertOutcome($this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key()));
        if ($case->outcome === Outcome::Dismissed) {
            $names = array_column($this->listRows($this->requestAs($case->actor, 'GET', '/notes/notebooks')), 'name');
            $this->assertNotContains($target['name'], $names, $case->key().': dismissed notebook still listed for the actor.');
        }
    }

    private function runCreateNotebook(OwnershipCase $case): void
    {
        $groupSlug = match ($case->scope) {
            Scope::OwnUser => null,
            Scope::OwnGroup => OwnershipPrincipals::CREW,
            Scope::OtherGroup, Scope::OtherUser => OwnershipPrincipals::OUTSIDERS,
            Scope::FormerGroup => OwnershipPrincipals::ALUMNI,
            default => throw new LogicException('No create-notebook target for '.$case->scope->value),
        };
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $payload = ['name' => 'created in '.$case->scope->value];
        if ($groupSlug !== null) {
            $payload['groupSlug'] = $groupSlug;
        }
        $response = $this->requestAs($case->actor, 'POST', '/notes/notebooks', $payload);
        $this->assertRestOutcome($response, $case);

        if ($case->variant === 'unknown-group') {
            $unknown = $this->requestAs($case->actor, 'POST', '/notes/notebooks', ['name' => $payload['name'], 'groupSlug' => 'no-such-group']);
            $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
            $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');
        }

        if ($case->outcome !== Outcome::Allowed) {
            // A member of the named group must not see a new notebook there.
            $witness = $case->scope === Scope::FormerGroup
                ? $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin)
                : OwnershipPrincipals::CAROL;
            $names = array_column($this->listRows($this->requestAsUsername($witness, 'GET', '/notes/notebooks')), 'name');
            $this->assertNotContains($payload['name'], $names, $case->key().': notebook created in a group the actor is not in.');
        }
    }

    /**
     * The actor hands its own notebook to a group it is not in.
     */
    private function runTransferIn(OwnershipCase $case): void
    {
        $self = $this->usernameFor($case->actor);
        $name = 'transfer '.$case->scope->value;
        $notebookId = $this->createNotebook($self, $name, null);
        [$slug, $witness] = $case->scope === Scope::FormerGroup
            ? [OwnershipPrincipals::ALUMNI, $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin)]
            : [OwnershipPrincipals::OUTSIDERS, OwnershipPrincipals::CAROL];
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $response = $this->requestAs($case->actor, 'PATCH', '/notes/notebooks/'.$notebookId, ['groupSlug' => $slug]);
        $this->assertRestOutcome($response, $case);
        $unknown = $this->requestAs($case->actor, 'PATCH', '/notes/notebooks/'.$notebookId, ['groupSlug' => 'no-such-group']);
        $this->assertSame($response->getStatusCode(), $unknown->getStatusCode(), $case->key().': existing and unknown groups differ.');
        $this->assertSame($response->json(), $unknown->json(), $case->key().': existing and unknown groups differ.');

        $names = array_column($this->listRows($this->requestAsUsername($witness, 'GET', '/notes/notebooks')), 'name');
        $this->assertNotContains($name, $names, $case->key().': notebook moved into a group the actor is not in.');
        $this->requestAs($case->actor, 'GET', '/notes/notebooks/'.$notebookId)->assertOk();
    }

    // ---- REST notes -------------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNoteIndex(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'starred') {
            $this->runStarredIndex($case, $target);

            return;
        }

        $response = $this->requestAs($case->actor, 'GET', '/notes/items?notebookId='.urlencode($target['actorNotebookId']));
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['noteId'], $this->rowIds($response), $case->key());
        }
    }

    /**
     * The starred view lists only notes the actor can still see, whatever it
     * starred before.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runStarredIndex(OwnershipCase $case, array $target): void
    {
        if (in_array($case->scope, self::VISIBLE, true)) {
            $this->requestAs($case->actor, 'POST', '/notes/items/'.$target['noteId'].'/star')->assertOk();
        }

        $ids = $this->rowIds($this->requestAs($case->actor, 'GET', '/notes/items?starred=true'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['noteId'], $ids, $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['noteId']], $ids, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNoteChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'GET', '/notes/items/changes?notebookId='.urlencode($target['actorNotebookId']));
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['noteId'], array_map('strval', (array) $response->json('created')), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNoteShow(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'yjs') {
            $response = $this->requestAs($case->actor, 'GET', '/notes/items/'.$target['noteId'].'?format=yjs');
            $this->assertRestOutcome($response, $case);
            if ($case->outcome === Outcome::NotFound) {
                $this->assertSameAsMissing($response, fn () => $this->requestAs($case->actor, 'GET', '/notes/items/'.Str::uuid().'?format=yjs'), $case);
            }

            return;
        }

        $response = $this->requestAs($case->actor, 'GET', '/notes/items/'.$target['noteId']);
        $this->assertRestOutcome($response, $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('note '.$case->scope->value, $response->json('title'), $case->key());
        }
        if ($case->outcome === Outcome::NotFound) {
            $this->assertSameAsMissing($response, fn () => $this->requestAs($case->actor, 'GET', '/notes/items/'.Str::uuid()), $case);
        }
    }

    /**
     * Creates a note in the scope's notebook: the notebook is the target.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNoteCreate(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'foreign-uid') {
            $this->runForeignUid($case, $target);

            return;
        }

        $send = fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/notes/items', [
            'notebookId' => $target['actorNotebookId'],
            'title' => 'created by actor',
        ]);

        if ($case->outcome === Outcome::Allowed) {
            $response = $send();
            $this->assertRestOutcome($response, $case);
            $this->assertContains((string) $response->json('id'), $this->ownerNoteIds($target), $case->key().': note missing from the notebook.');

            return;
        }
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $this->assertRestOutcome($this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key()), $case);
    }

    /**
     * The actor creates a note in its own notebook with the UID of a note it
     * cannot see. The create must answer as for an unused UID and leave the
     * other note alone.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $foreign
     */
    private function runForeignUid(OwnershipCase $case, array $foreign): void
    {
        $self = $this->usernameFor($case->actor);
        $ownNotebookId = $this->createNotebook($self, 'own notebook for uid', null);

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($foreign),
            fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/notes/items', [
                'notebookId' => $ownNotebookId,
                'title' => 'own note',
                'uid' => $foreign['noteId'],
            ]),
            $case->key(),
        );
        $this->assertRestOutcome($response, $case);

        $snapshot = $this->ownerSnapshot($foreign);
        $this->assertArrayHasKey($foreign['noteId'], $snapshot['notes'], $case->key().': owner lost the note.');
        $markers = [$foreign['name']];
        foreach ($snapshot['notes'] as [$title, $body]) {
            $markers[] = $title;
            $markers[] = $body;
        }
        foreach (array_filter($markers, static fn (mixed $marker): bool => is_string($marker) && $marker !== '') as $marker) {
            $this->assertStringNotContainsString($marker, (string) $response->getContent(), $case->key().': other note content in the response.');
        }

        if ($response->isSuccessful()) {
            $fresh = $this->requestAs($case->actor, 'POST', '/notes/items', [
                'notebookId' => $ownNotebookId,
                'title' => 'own note',
                'uid' => (string) Str::uuid(),
            ]);
            $this->assertSame($fresh->getStatusCode(), $response->getStatusCode(), $case->key().': used and unused UIDs differ.');
        }
    }

    /**
     * PATCH, PUT, and DELETE on the target note.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runNoteWrite(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'move-in') {
            $this->runMoveIn($case, $target);

            return;
        }

        [$method] = explode(' ', $case->operation, 2);
        $url = '/notes/items/'.$target['noteId'];
        $isPut = $method === 'PUT';
        $send = match ($method) {
            // The collaboration save: markdown plus Yjs state, first write.
            'PUT' => fn (): TestResponse => $this->putCollaboration(
                '/api/v1'.$url,
                'replaced by actor',
                "\x01\x02\x03",
                array_merge($this->headersFor($case->actor), ['If-None-Match' => '*']),
            ),
            // The owner's current ETag: the strongest precondition another client could send.
            'PATCH' => fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', $url, ['title' => 'patched by actor'], ['If-Match' => $target['etag']]),
            default => fn (): TestResponse => $this->requestAs($case->actor, 'DELETE', $url, [], ['If-Match' => $target['etag']]),
        };

        if ($case->outcome === Outcome::Allowed) {
            $this->assertRestOutcome($send(), $case);
            if ($method === 'DELETE') {
                $this->assertNull($this->ownerNote($target), $case->key().': note still exists after delete.');
            }

            return;
        }
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $this->assertRestOutcome($this->assertUnchanged(fn () => $this->ownerSnapshot($target, $isPut), $send, $case->key()), $case);
    }

    /**
     * The actor moves its own note into the scope's notebook. A refused move
     * leaves the note where it was and adds nothing to the target notebook.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $destination
     */
    private function runMoveIn(OwnershipCase $case, array $destination): void
    {
        $self = $this->usernameFor($case->actor);
        $ownNotebookId = $this->createNotebook($self, 'own notebook for move', null);
        [$ownNoteId, $etag] = $this->createNote($self, $ownNotebookId, 'own note');

        if ($case->operation === 'JMAP Note/set') {
            $send = fn (): TestResponse => $this->jmap($case->actor, 'Note/set', [
                'update' => [$ownNoteId => ['notebookId' => $destination['actorNotebookId'], 'etag' => $etag]],
            ]);
            $assertOutcome = fn (TestResponse $response) => $this->assertJmapSetOutcome($response, 'update', $ownNoteId, $case);
        } else {
            $send = fn (): TestResponse => $this->requestAs($case->actor, 'PATCH', '/notes/items/'.$ownNoteId, [
                'notebookId' => $destination['actorNotebookId'],
            ], ['If-Match' => $etag]);
            $assertOutcome = fn (TestResponse $response) => $this->assertRestOutcome($response, $case);
        }

        $destinationIds = fn (): array => $this->rowIds($this->requestAsUsername($destination['owner'], 'GET', '/notes/items?notebookId='.urlencode($destination['ownerNotebookId'])));
        if ($case->outcome === Outcome::Allowed) {
            $assertOutcome($send());
            $this->assertContains($ownNoteId, $destinationIds(), $case->key().': note did not arrive.');

            return;
        }

        $assertOutcome($this->assertUnchanged($destinationIds, $send, $case->key()));
        $ownIds = $this->rowIds($this->requestAs($case->actor, 'GET', '/notes/items?notebookId='.urlencode($ownNotebookId)));
        $this->assertContains($ownNoteId, $ownIds, $case->key().': note left the actor notebook.');
    }

    /**
     * Star and unstar. A star is the actor's own state: the owner's star on
     * the same note never changes.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runStar(OwnershipCase $case, array $target): void
    {
        $unstar = str_starts_with($case->operation, 'DELETE');
        $method = $unstar ? 'DELETE' : 'POST';
        $path = '/notes/items/'.$target['noteId'].'/star';
        $send = fn (): TestResponse => $this->requestAs($case->actor, $method, $path);
        if ($case->outcome === Outcome::Unauthenticated) {
            $this->assertRestOutcome($send(), $case);

            return;
        }

        $actorIsOwner = $target['owner'] === $this->usernameFor($case->actor);
        if ($unstar && ! $actorIsOwner) {
            // The owner starred it too; the actor's unstar must not clear that.
            $this->requestAsUsername($target['owner'], 'POST', $path)->assertOk();
        }
        if ($unstar && in_array($case->scope, self::VISIBLE, true)) {
            $this->requestAs($case->actor, 'POST', $path)->assertOk();
        }

        if ($case->outcome === Outcome::Allowed) {
            $response = $actorIsOwner
                ? $send()
                : $this->assertUnchanged(fn () => $this->ownerNote($target)[3] ?? null, $send, $case->key());
            $this->assertRestOutcome($response, $case);
            $starred = $this->requestAs($case->actor, 'GET', '/notes/items/'.$target['noteId'])->assertOk()->json('starred');
            $this->assertSame(! $unstar, $starred, $case->key().': actor star state.');

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        $this->assertRestOutcome($response, $case);
        $this->assertSameAsMissing($response, fn () => $this->requestAs($case->actor, $method, '/notes/items/'.Str::uuid().'/star'), $case);
        if (! $unstar) {
            $starredIds = $this->rowIds($this->requestAs($case->actor, 'GET', '/notes/items?starred=true'));
            $this->assertIdsAbsent([$target['noteId']], $starredIds, $case->key());
        }
    }

    private function runGroupDefault(OwnershipCase $case): void
    {
        $slug = $case->scope === Scope::FormerGroup ? OwnershipPrincipals::ALUMNI : OwnershipPrincipals::OUTSIDERS;
        $witness = $case->scope === Scope::FormerGroup
            ? $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin)
            : OwnershipPrincipals::CAROL;
        $notebookId = CalendarCollectionUris::groupNotebookApiId($slug);
        $witnessItems = fn (): mixed => $this->rowIds($this->requestAsUsername($witness, 'GET', '/notes/items?notebookId='.$notebookId));
        $witnessItems();
        if ($case->scope === Scope::FormerGroup) {
            $this->leaveFormerGroup($case->actor);
        }

        $send = $case->operation === 'POST /notes/items'
            ? fn (): TestResponse => $this->requestAs($case->actor, 'POST', '/notes/items', ['notebookId' => $notebookId, 'title' => 'into group default'])
            : fn (): TestResponse => $this->requestAs($case->actor, 'GET', '/notes/notebooks/'.$notebookId);

        $this->assertRestOutcome($this->assertUnchanged($witnessItems, $send, $case->key()), $case);
    }

    // ---- JMAP ---------------------------------------------------------------

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapNotebookGet(OwnershipCase $case, array $target): void
    {
        $response = $this->jmap($case->actor, 'Notebook/get', ['ids' => [$target['actorNotebookId']]]);
        $this->assertJmapGetOutcome($response, $target['actorNotebookId'], $case);
        if ($case->outcome === Outcome::NotFound) {
            $this->assertIdsAbsent([$target['ownerNotebookId']], array_column((array) $response->json('methodResponses.0.1.list'), 'id'), $case->key());
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapNoteGet(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'all') {
            $response = $this->jmap($case->actor, 'Note/get', ['ids' => null])->assertOk();
            $this->assertSame('Note/get', $response->json('methodResponses.0.0'), $case->key());
            $this->assertIdsAbsent([$target['noteId']], array_column((array) $response->json('methodResponses.0.1.list'), 'id'), $case->key());

            return;
        }

        $response = $this->jmap($case->actor, 'Note/get', ['ids' => [$target['noteId']]]);
        $this->assertJmapGetOutcome($response, $target['noteId'], $case);
    }

    /**
     * Note/query without a filter, and filtered on the notebook the actor
     * addresses (and the owner's id, where that differs). A hidden notebook
     * in the filter answers exactly like a notebook id that never existed.
     *
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapNoteQuery(OwnershipCase $case, array $target): void
    {
        $query = fn (array $filter): TestResponse => $this->jmap($case->actor, 'Note/query', $filter === [] ? [] : ['filter' => $filter]);
        $ids = function (TestResponse $response) use ($case): array {
            $response->assertOk();
            $this->assertSame('Note/query', $response->json('methodResponses.0.0'), $case->key().': '.json_encode($response->json('methodResponses.0')));

            return array_map('strval', (array) $response->json('methodResponses.0.1.ids'));
        };

        $all = $ids($query([]));
        $notebookIds = array_values(array_unique([$target['actorNotebookId'], $target['ownerNotebookId']]));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['noteId'], $all, $case->key().': note missing from the unfiltered query.');
            $this->assertContains($target['noteId'], $ids($query(['inNotebook' => $target['actorNotebookId']])), $case->key().': note missing from the notebook query.');

            return;
        }

        $this->assertIdsAbsent([$target['noteId']], $all, $case->key());
        $missing = $query(['inNotebook' => 'no-such-notebook-'.Str::uuid()])->json('methodResponses.0');
        foreach ($notebookIds as $notebookId) {
            $response = $query(['inNotebook' => $notebookId]);
            $this->assertSame([], $ids($response), $case->key().': hidden notebook '.$notebookId.' matched notes.');
            $this->assertSame($missing, $response->json('methodResponses.0'), $case->key().': hidden and missing notebooks differ.');
        }
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapChanges(OwnershipCase $case, array $target): void
    {
        $method = substr($case->operation, strlen('JMAP '));
        $response = $this->jmap($case->actor, $method, ['sinceState' => $target['since'] ?? '0:']);
        $response->assertOk();
        $this->assertSame($method, $response->json('methodResponses.0.0'), $case->key().': '.json_encode($response->json('methodResponses.0')));

        $ids = $method === 'Note/changes'
            ? [$target['noteId']]
            : array_values(array_unique([$target['ownerNotebookId'], $target['actorNotebookId']]));
        $created = array_map('strval', (array) $response->json('methodResponses.0.1.created'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($method === 'Note/changes' ? $target['noteId'] : $target['actorNotebookId'], $created, $case->key());

            return;
        }
        $listed = array_merge($created, array_map('strval', (array) $response->json('methodResponses.0.1.updated')));
        $this->assertIdsAbsent($ids, $listed, $case->key());
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapNotebookSet(OwnershipCase $case, array $target): void
    {
        $id = $target['actorNotebookId'];
        if ($case->variant === 'destroy') {
            $send = fn (): TestResponse => $this->jmap($case->actor, 'Notebook/set', ['destroy' => [$id], 'onDestroyRemoveContents' => true]);
            $this->assertNotebookDelete($case, $target, $send, fn (TestResponse $response) => $this->assertJmapSetOutcome($response, 'destroy', $id, $case));

            return;
        }

        $send = fn (): TestResponse => $this->jmap($case->actor, 'Notebook/set', ['update' => [$id => ['name' => 'renamed by actor']]]);
        $this->assertNotebookWrite($case, $target, $send, fn (TestResponse $response) => $this->assertJmapSetOutcome($response, 'update', $id, $case));
    }

    /**
     * @param  array{owner: string, name: string, ownerNotebookId: string, actorNotebookId: string, noteId: string, etag: string, since: ?string}  $target
     */
    private function runJmapNoteSet(OwnershipCase $case, array $target): void
    {
        if ($case->variant === 'move-in') {
            $this->runMoveIn($case, $target);

            return;
        }

        $noteId = $target['noteId'];
        $send = fn (): TestResponse => $this->jmap($case->actor, 'Note/set', [
            'create' => ['k0' => ['notebookId' => $target['actorNotebookId'], 'title' => 'created by actor']],
            'update' => [$noteId => ['title' => 'patched by actor', 'etag' => $target['etag']]],
            'destroy' => [$noteId],
        ]);

        if ($case->outcome === Outcome::Allowed) {
            $response = $send();
            foreach (['create' => 'k0', 'update' => $noteId, 'destroy' => $noteId] as $operation => $id) {
                $this->assertJmapSetOutcome($response, $operation, $id, $case);
            }
            $ownerIds = $this->ownerNoteIds($target);
            $this->assertContains((string) $response->json('methodResponses.0.1.created.k0.id'), $ownerIds, $case->key());
            $this->assertNotContains($noteId, $ownerIds, $case->key());

            return;
        }

        $response = $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
        foreach (['create' => 'k0', 'update' => $noteId, 'destroy' => $noteId] as $operation => $id) {
            $this->assertJmapSetOutcome($response, $operation, $id, $case);
        }
    }

    /**
     * The owner's accountId with an object of the owner: the dispatcher
     * refuses the account before it looks at any id.
     */
    private function runForeignAccount(OwnershipCase $case): void
    {
        $target = $this->seedTarget($case);
        $carol = OwnershipPrincipals::CAROL;
        $method = substr($case->operation, strlen('JMAP '));
        $args = match ($method) {
            'Notebook/get' => ['ids' => [$target['ownerNotebookId']]],
            'Note/get' => ['ids' => [$target['noteId']]],
            'Notebook/changes', 'Note/changes', 'Note/queryChanges' => ['sinceState' => '0:'],
            'Note/query' => ['filter' => ['inNotebook' => $target['ownerNotebookId']]],
            'Notebook/set' => ['update' => [$target['ownerNotebookId'] => ['name' => 'renamed by actor']]],
            'Note/set' => ['update' => [$target['noteId'] => ['title' => 'patched by actor', 'etag' => $target['etag']]]],
            default => throw new LogicException('No foreign-account call for '.$method),
        };

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->jmap($case->actor, $method, $args, $carol),
            $case->key(),
        );
        $this->assertJmapMethodError($response, 'accountNotFound', $case);
    }

    private function runQueryChanges(OwnershipCase $case): void
    {
        $target = $this->seedTarget($case);
        $response = $this->jmap($case->actor, 'Note/queryChanges', ['sinceQueryState' => '0', 'filter' => ['inNotebook' => $target['ownerNotebookId']]]);
        $this->assertJmapMethodError($response, 'cannotCalculateChanges', $case);
        $this->assertStringNotContainsString($target['noteId'], (string) $response->getContent(), $case->key());
    }
}
