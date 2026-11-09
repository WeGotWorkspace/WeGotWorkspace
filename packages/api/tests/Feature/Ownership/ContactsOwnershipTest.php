<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\Addressbook;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
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
 * Ownership matrix for contacts (plan chunk-f-contacts): JMAP AddressBook/*
 * and ContactCard/*, and REST POST /contacts/cards/import.
 *
 * Each principal has exactly one address book: a user's is `default`, a
 * group's is `group-<slug>`, and a sharee sees an inbound share as
 * `shared-<id>`. Each case seeds one book holding one card, owned and shared
 * as the scope describes. Invisible user-owned books are addressed by the
 * `shared-<id>` the actor would see, because `default` always names the
 * actor's own book.
 */
final class ContactsOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;

    private const IMPORT = 'POST /contacts/cards/import';

    private const USING = [JmapCapabilities::CORE, JmapCapabilities::CONTACTS];

    private const BOOK_READ_METHODS = ['AddressBook/get', 'AddressBook/changes'];

    private const CARD_READ_METHODS = ['ContactCard/get', 'ContactCard/changes', 'ContactCard/query', 'ContactCard/queryChanges'];

    /** ContactCard/set variants; move-in names the scope's book as destination, move-out as source. */
    private const CARD_WRITE_VARIANTS = ['create', 'update', 'destroy', 'move-in', 'move-out'];

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
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
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
                $read = $visible ? Outcome::Allowed : Outcome::NotFound;
                $write = ! $visible ? Outcome::NotFound : ($readOnly ? Outcome::Forbidden : Outcome::Allowed);
                // Book metadata and sharing belong to the owner; a sharee has no copy of its own.
                $bookWrite = ! $visible ? Outcome::NotFound : ($sharee ? Outcome::Forbidden : Outcome::Allowed);

                foreach (array_merge(self::BOOK_READ_METHODS, self::CARD_READ_METHODS) as $method) {
                    // queryChanges answers the same for every visible book; own-user stands for them.
                    if ($method === 'ContactCard/queryChanges' && $visible && $scope !== Scope::OwnUser) {
                        continue;
                    }
                    $cases[] = OwnershipCase::of(OwnershipRegistry::jmapKey($method), $actor, $scope, $read);
                }

                $bookSet = OwnershipRegistry::jmapKey('AddressBook/set');
                $cases[] = OwnershipCase::of($bookSet, $actor, $scope, $bookWrite)->variant('update');
                $cases[] = OwnershipCase::of($bookSet, $actor, $scope, $bookWrite)->variant('reshare');
                $cases[] = self::bookDestroyCase($actor, $scope, $visible, $sharee);

                foreach (self::CARD_WRITE_VARIANTS as $variant) {
                    $cases[] = OwnershipCase::of(OwnershipRegistry::jmapKey('ContactCard/set'), $actor, $scope, $write)->variant($variant);
                }

                $cases[] = OwnershipCase::of(self::IMPORT, $actor, $scope, $write);
            }

            // One book per principal, provisioned by the server: AddressBookRepository::create()
            // refuses every create, so there is no owner field to aim at another scope.
            $cases[] = OwnershipCase::of(OwnershipRegistry::jmapKey('AddressBook/set'), $actor, Scope::OwnUser, Outcome::Forbidden)->variant('create');
        }

        foreach (['AddressBook/get', 'AddressBook/changes', 'AddressBook/set', 'ContactCard/get', 'ContactCard/changes', 'ContactCard/set', 'ContactCard/query', 'ContactCard/queryChanges'] as $method) {
            $cases[] = OwnershipCase::of(OwnershipRegistry::jmapKey($method), Actor::Member, Scope::OtherUser, Outcome::AccountNotFound)->variant('foreign-account');
        }

        // Group membership is checked per request: leaving `crew` ends the access.
        $cases[] = OwnershipCase::of(OwnershipRegistry::jmapKey('AddressBook/get'), Actor::Member, Scope::UserToActorGroup, Outcome::NotFound)->variant('left-crew');

        $cases[] = OwnershipCase::of(self::IMPORT, Actor::Anonymous, Scope::OtherUser, Outcome::Unauthenticated);

        return array_values(array_filter($cases, self::inRuntimeBudget(...)));
    }

    /**
     * Admin has no per-object bypass, so its rows matter where a bypass would
     * show: every row the member is denied. Rows the member is allowed add
     * only runtime for admin.
     */
    private static function inRuntimeBudget(OwnershipCase $case): bool
    {
        return $case->actor !== Actor::Admin
            || in_array($case->outcome, [Outcome::NotFound, Outcome::Forbidden, Outcome::Dismissed], true);
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

    private static function bookDestroyCase(Actor $actor, Scope $scope, bool $visible, bool $sharee): OwnershipCase
    {
        $op = OwnershipRegistry::jmapKey('AddressBook/set');
        if (! $visible) {
            return OwnershipCase::of($op, $actor, $scope, Outcome::NotFound)->variant('destroy');
        }
        if ($sharee) {
            return OwnershipCase::of($op, $actor, $scope, Outcome::Dismissed)->variant('destroy');
        }

        // The personal book and the group book are provisioned defaults.
        return OwnershipCase::of($op, $actor, $scope, Outcome::Forbidden)->variant('destroy');
    }

    private function runCase(OwnershipCase $case): void
    {
        if ($case->actor === Actor::Anonymous) {
            $this->assertRestOutcome($this->importAs($case->actor, AddressBookCollectionUris::PERSONAL_DEFAULT), $case);

            return;
        }
        if ($case->variant === 'create') {
            $this->runBookCreate($case);

            return;
        }

        $target = $this->seedTarget($case->scope, $case->actor);
        if ($case->variant === 'foreign-account') {
            $this->runForeignAccount($case, $target);

            return;
        }

        if ($case->variant === 'left-crew') {
            $this->runLeftCrew($case, $target);

            return;
        }

        match ($case->operation) {
            OwnershipRegistry::jmapKey('AddressBook/get') => $this->runBookGet($case, $target),
            OwnershipRegistry::jmapKey('AddressBook/changes') => $this->runBookChanges($case, $target),
            OwnershipRegistry::jmapKey('AddressBook/set') => $this->runBookSet($case, $target),
            OwnershipRegistry::jmapKey('ContactCard/get') => $this->runCardGet($case, $target),
            OwnershipRegistry::jmapKey('ContactCard/changes') => $this->runCardChanges($case, $target),
            OwnershipRegistry::jmapKey('ContactCard/query') => $this->runCardQuery($case, $target),
            OwnershipRegistry::jmapKey('ContactCard/queryChanges') => $this->runCardQueryChanges($case, $target),
            OwnershipRegistry::jmapKey('ContactCard/set') => $this->runCardSet($case, $target),
            self::IMPORT => $this->runImport($case, $target),
            default => throw new LogicException('No runner for '.$case->operation),
        };
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runLeftCrew(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $get = fn (string $username) => $this->jmap($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => [$target['actorBookId']]], 'g'],
            ['AddressBook/get', ['accountId' => $username, 'ids' => null], 'a'],
        ]);

        $before = $get($account);
        $this->assertSame($target['actorBookId'], $before->json('methodResponses.0.1.list.0.id'), $case->key());

        $this->assertUnchanged(fn () => $this->ownerSnapshot($target), fn () => $this->leaveCrew($case->actor), $case->key());

        // Same token as before leaving.
        $after = $get($account);
        $this->assertJmapGetOutcome($after, $target['actorBookId'], $case);
        $all = array_map('strval', array_column((array) $after->json('methodResponses.1.1.list'), 'id'));
        $this->assertIdsAbsent([$target['actorBookId']], $all, $case->key());
        // The other actor stays in crew and keeps the book (dave owns it).
        $other = $this->usernameFor($case->actor === Actor::Admin ? Actor::Member : Actor::Admin);
        $this->assertSame($target['actorBookId'], $get($other)->json('methodResponses.0.1.list.0.id'), $case->key().': '.$other.' lost access.');
    }

    // ---- Target seeding -------------------------------------------------

    /**
     * @return array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}
     */
    private function seedTarget(Scope $scope, Actor $actor): array
    {
        $carol = OwnershipPrincipals::CAROL;
        $self = $this->usernameFor($actor);
        $default = AddressBookCollectionUris::PERSONAL_DEFAULT;

        [$owner, $groupSlug] = match ($scope) {
            Scope::OwnUser => [$self, null],
            Scope::OwnGroup => [OwnershipPrincipals::DAVE, OwnershipPrincipals::CREW],
            Scope::OtherGroup, Scope::GroupToNonmemberRead, Scope::GroupToNonmemberWrite => [$carol, OwnershipPrincipals::OUTSIDERS],
            // The other actor stays in alumni, so the owner's view still works
            // after this actor leaves.
            Scope::FormerGroup => [$this->usernameFor($actor === Actor::Admin ? Actor::Member : Actor::Admin), OwnershipPrincipals::ALUMNI],
            // Epic #1915: a Team share needs an owner in that Team; dave is in crew.
            Scope::UserToActorGroup => [OwnershipPrincipals::DAVE, null],
            default => [$carol, null],
        };
        $ownerBookId = $groupSlug === null ? $default : AddressBookCollectionUris::groupApiId($groupSlug);

        $cardId = $this->createCard($owner, $ownerBookId, 'card '.$scope->value);
        $bookPk = (int) Addressbook::query()
            ->where('principaluri', $groupSlug === null ? 'principals/'.$owner : OwnershipPrincipals::groupUri($groupSlug))
            ->value('id');

        $actorBookId = in_array($scope, [Scope::OwnUser, Scope::OwnGroup, Scope::OtherGroup, Scope::FormerGroup], true)
            ? $ownerBookId
            : AddressBookCollectionUris::sharedApiId($bookPk);
        $liveState = '0';

        switch ($scope) {
            case Scope::UserToActorRead:
            case Scope::GroupToNonmemberRead:
                $this->share($owner, $ownerBookId, $self, ['mayRead' => true]);
                break;
            case Scope::UserToActorWrite:
            case Scope::GroupToNonmemberWrite:
                $this->share($owner, $ownerBookId, $self, ['mayRead' => true, 'mayWrite' => true]);
                break;
            case Scope::UserToActorGroup:
                $this->share($owner, $ownerBookId, 'groups/'.OwnershipPrincipals::CREW, ['mayRead' => true, 'mayWrite' => true]);
                break;
            case Scope::GrantRevoked:
                $this->share($owner, $ownerBookId, $self, ['mayRead' => true, 'mayWrite' => true]);
                $liveState = $this->stateSeenBy($self, $actorBookId, $cardId);
                $this->share($owner, $ownerBookId, $self, null);
                break;
            case Scope::GrantDismissed:
                $this->share($owner, $ownerBookId, $self, ['mayRead' => true, 'mayWrite' => true]);
                $liveState = $this->stateSeenBy($self, $actorBookId, $cardId);
                $dismissed = $this->jmap($self, [['AddressBook/set', ['accountId' => $self, 'destroy' => [$actorBookId]], 'd']]);
                $this->assertContains($actorBookId, (array) $dismissed->json('methodResponses.0.1.destroyed'), 'dismiss failed');
                break;
            case Scope::FormerGroup:
                $this->leaveFormerGroup($actor);
                break;
            default:
                break;
        }

        return [
            'owner' => $owner,
            'ownerBookId' => $ownerBookId,
            'actorBookId' => $actorBookId,
            'bookPk' => $bookPk,
            'cardId' => $cardId,
            'liveState' => $liveState,
        ];
    }

    private function createCard(string $username, string $bookId, string $fullName): string
    {
        $response = $this->jmap($username, [['ContactCard/set', ['accountId' => $username, 'create' => ['t' => [
            'addressBookIds' => [$bookId => true],
            'name' => ['full' => $fullName],
        ]]], 'c']]);
        $id = $response->json('methodResponses.0.1.created.t.id');
        $this->assertIsString($id, $username.' could not create a card in '.$bookId.': '.$response->getContent());

        return $id;
    }

    /**
     * @param  array<string, bool>|null  $rights
     */
    private function share(string $owner, string $bookId, string $grantee, ?array $rights): void
    {
        $response = $this->jmap($owner, [['AddressBook/set', ['accountId' => $owner, 'update' => [
            $bookId => ['shareWith' => [$grantee => $rights]],
        ]], 's']]);
        $this->assertArrayHasKey($bookId, (array) $response->json('methodResponses.0.1.updated'), 'share failed: '.$response->getContent());
    }

    /**
     * The actor's account state while a grant is live, after reading its card,
     * so later changes calls start from a state that included the book.
     */
    private function stateSeenBy(string $username, string $bookId, string $cardId): string
    {
        $response = $this->jmap($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => [$bookId]], 'b'],
            ['ContactCard/get', ['accountId' => $username, 'ids' => [$cardId]], 'c'],
        ]);
        $this->assertSame($bookId, $response->json('methodResponses.0.1.list.0.id'), $username.' does not see '.$bookId);

        return (string) $response->json('methodResponses.0.1.state');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function jmap(string $username, array $calls): TestResponse
    {
        return $this->requestAsUsername($username, 'POST', '/jmap', ['using' => self::USING, 'methodCalls' => $calls])->assertOk();
    }

    private function importAs(Actor $actor, string $bookId): TestResponse
    {
        $server = ['CONTENT_TYPE' => 'text/vcard', 'HTTP_ACCEPT' => 'application/json'];
        $token = $this->tokenFor($actor);
        if ($token !== null) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:7d0c3a52-5b0e-4d4e-9a57-0f2b6f1c9e01\r\nFN:Imported by actor\r\nEND:VCARD\r\n";

        return $this->call('POST', '/api/v1/contacts/cards/import?addressBookId='.urlencode($bookId), [], [], [], $server, $vcard);
    }

    /**
     * The owner's view of the target, for proving a denied write changed nothing.
     *
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     * @return array<string, mixed>
     */
    private function ownerSnapshot(array $target): array
    {
        $owner = $target['owner'];
        $response = $this->jmap($owner, [
            ['AddressBook/get', ['accountId' => $owner, 'ids' => [$target['ownerBookId']]], 'b'],
            ['ContactCard/query', ['accountId' => $owner, 'filter' => ['inAddressBook' => $target['ownerBookId']]], 'q'],
            ['ContactCard/get', ['accountId' => $owner, 'ids' => [$target['cardId']]], 'c'],
        ]);
        $ids = (array) $response->json('methodResponses.1.1.ids');
        sort($ids);

        return [
            'description' => $response->json('methodResponses.0.1.list.0.description'),
            'shareWith' => $response->json('methodResponses.0.1.list.0.shareWith'),
            'cardIds' => $ids,
            'cardName' => $response->json('methodResponses.2.1.list.0.name.full'),
        ];
    }

    /**
     * Ids the actor must not see for an invisible target. `default` always
     * names the actor's own book, so it is never one of them.
     *
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     * @return list<string>
     */
    private function deniedBookIds(array $target): array
    {
        return array_values(array_unique(array_filter(
            [$target['actorBookId'], $target['ownerBookId']],
            static fn (string $id): bool => $id !== AddressBookCollectionUris::PERSONAL_DEFAULT,
        )));
    }

    /**
     * An id of the same shape as the target's that names no book.
     *
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function unknownBookId(array $target): string
    {
        return str_starts_with($target['actorBookId'], 'group-')
            ? AddressBookCollectionUris::groupApiId('no-such-group')
            : AddressBookCollectionUris::sharedApiId($target['bookPk'] + 100000);
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function sinceStateFor(OwnershipCase $case, array $target): string
    {
        return in_array($case->scope, [Scope::GrantRevoked, Scope::GrantDismissed], true) ? $target['liveState'] : '0';
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function actorJmap(OwnershipCase $case, array $calls): TestResponse
    {
        return $this->jmapAs($case->actor, $calls, self::USING);
    }

    private function actorAccount(OwnershipCase $case): string
    {
        return $this->accountIdFor($case->actor);
    }

    /**
     * Runs a write; denied outcomes must leave the owner's view unchanged.
     *
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     * @param  callable(): TestResponse  $send
     */
    private function guardedWrite(OwnershipCase $case, array $target, callable $send): TestResponse
    {
        if ($case->outcome === Outcome::Allowed) {
            return $send();
        }

        return $this->assertUnchanged(fn () => $this->ownerSnapshot($target), $send, $case->key());
    }

    // ---- Runners ---------------------------------------------------------

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runForeignAccount(OwnershipCase $case, array $target): void
    {
        $method = substr($case->operation, strlen(OwnershipRegistry::jmapKey('')));
        $owner = $target['owner'];
        $args = match ($method) {
            'AddressBook/get' => ['ids' => [$target['ownerBookId']]],
            'AddressBook/changes', 'ContactCard/changes' => ['sinceState' => '0'],
            'AddressBook/set' => ['update' => [$target['ownerBookId'] => ['description' => 'changed by actor', 'shareWith' => [$this->usernameFor($case->actor) => ['mayRead' => true, 'mayWrite' => true]]]]],
            'ContactCard/get' => ['ids' => [$target['cardId']]],
            'ContactCard/set' => [
                'create' => ['n' => ['addressBookIds' => [$target['ownerBookId'] => true], 'name' => ['full' => 'created by actor']]],
                'update' => [$target['cardId'] => ['name' => ['full' => 'patched by actor']]],
            ],
            'ContactCard/query' => ['filter' => ['inAddressBook' => $target['ownerBookId']]],
            'ContactCard/queryChanges' => ['filter' => ['inAddressBook' => $target['ownerBookId']], 'sinceQueryState' => '0'],
            default => throw new LogicException('No foreign-account call for '.$method),
        };

        $response = $this->assertUnchanged(
            fn () => $this->ownerSnapshot($target),
            fn (): TestResponse => $this->actorJmap($case, [[$method, array_merge(['accountId' => $owner], $args), 'f']]),
            $case->key(),
        );
        $this->assertJmapMethodError($response, 'accountNotFound', $case);
        $this->assertStringNotContainsString($target['cardId'], (string) $response->getContent(), $case->key());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runBookGet(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $response = $this->actorJmap($case, [
            ['AddressBook/get', ['accountId' => $account, 'ids' => [$target['actorBookId']]], 'g'],
            ['AddressBook/get', ['accountId' => $account, 'ids' => null], 'a'],
        ]);
        $this->assertJmapGetOutcome($response, $target['actorBookId'], $case);

        $all = array_map('strval', array_column((array) $response->json('methodResponses.1.1.list'), 'id'));
        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorBookId'], $all, $case->key());

            return;
        }
        $this->assertIdsAbsent($this->deniedBookIds($target), $all, $case->key());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runBookChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->actorJmap($case, [
            ['AddressBook/changes', ['accountId' => $this->actorAccount($case), 'sinceState' => $this->sinceStateFor($case, $target)], 'c'],
        ]);
        $args = $response->json('methodResponses.0.1');
        $this->assertSame('AddressBook/changes', $response->json('methodResponses.0.0'), $case->key().': '.json_encode($args));
        $listed = array_merge((array) $args['created'], (array) $args['updated']);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['actorBookId'], (array) $args['created'], $case->key());

            return;
        }
        $this->assertIdsAbsent($this->deniedBookIds($target), $listed, $case->key());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runBookSet(OwnershipCase $case, array $target): void
    {
        $bookId = $target['actorBookId'];
        $account = $this->actorAccount($case);

        if ($case->variant === 'destroy') {
            $response = $this->assertUnchanged(
                fn () => $this->ownerSnapshot($target),
                fn (): TestResponse => $this->actorJmap($case, [['AddressBook/set', ['accountId' => $account, 'destroy' => [$bookId], 'onDestroyRemoveContents' => true], 'd']]),
                $case->key(),
            );
            $this->assertJmapSetOutcome($response, 'destroy', $bookId, $case);
            if ($case->outcome === Outcome::Dismissed) {
                $listed = array_column((array) $this->actorJmap($case, [['AddressBook/get', ['accountId' => $account, 'ids' => null], 'a']])->json('methodResponses.0.1.list'), 'id');
                $this->assertNotContains($bookId, $listed, $case->key().': dismissed book still listed for the actor.');
            }

            return;
        }

        $patch = $case->variant === 'reshare'
            ? ['shareWith' => [OwnershipPrincipals::DAVE => ['mayRead' => true]]]
            : ['description' => 'changed by actor'];
        $response = $this->guardedWrite(
            $case,
            $target,
            fn (): TestResponse => $this->actorJmap($case, [['AddressBook/set', ['accountId' => $account, 'update' => [$bookId => $patch]], 'u']]),
        );
        $this->assertJmapSetOutcome($response, 'update', $bookId, $case);
    }

    private function runBookCreate(OwnershipCase $case): void
    {
        $account = $this->actorAccount($case);
        $list = fn (): array => array_column((array) $this->actorJmap($case, [['AddressBook/get', ['accountId' => $account, 'ids' => null], 'a']])->json('methodResponses.0.1.list'), 'id');

        $response = $this->assertUnchanged(
            $list,
            fn (): TestResponse => $this->actorJmap($case, [['AddressBook/set', ['accountId' => $account, 'create' => ['n' => ['name' => 'created by actor']]], 'c']]),
            $case->key(),
        );
        $this->assertSame('forbidden', $response->json('methodResponses.0.1.notCreated.n.type'), $case->key().': '.$response->getContent());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runCardGet(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $response = $this->actorJmap($case, [
            ['ContactCard/get', ['accountId' => $account, 'ids' => [$target['cardId']]], 'g'],
            ['ContactCard/get', ['accountId' => $account, 'ids' => null], 'a'],
        ]);
        $this->assertJmapGetOutcome($response, $target['cardId'], $case);
        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('card '.$case->scope->value, $response->json('methodResponses.0.1.list.0.name.full'), $case->key());

            return;
        }
        $all = array_map('strval', array_column((array) $response->json('methodResponses.1.1.list'), 'id'));
        $this->assertIdsAbsent([$target['cardId']], $all, $case->key());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runCardChanges(OwnershipCase $case, array $target): void
    {
        $response = $this->actorJmap($case, [
            ['ContactCard/changes', ['accountId' => $this->actorAccount($case), 'sinceState' => $this->sinceStateFor($case, $target)], 'c'],
        ]);
        $args = $response->json('methodResponses.0.1');
        $this->assertSame('ContactCard/changes', $response->json('methodResponses.0.0'), $case->key().': '.json_encode($args));

        if ($case->outcome === Outcome::Allowed) {
            $this->assertContains($target['cardId'], (array) $args['created'], $case->key());

            return;
        }
        $this->assertIdsAbsent([$target['cardId']], array_merge((array) $args['created'], (array) $args['updated']), $case->key());
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runCardQuery(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $query = fn (?string $bookId): array => ['ContactCard/query', ['accountId' => $account, 'filter' => $bookId === null ? null : ['inAddressBook' => $bookId]], 'q'];
        $response = $this->actorJmap($case, [$query($target['actorBookId']), $query(null)]);

        if ($case->outcome === Outcome::Allowed) {
            $this->assertSame('ContactCard/query', $response->json('methodResponses.0.0'), $case->key().': '.$response->getContent());
            $this->assertContains($target['cardId'], (array) $response->json('methodResponses.0.1.ids'), $case->key());

            return;
        }

        $this->assertIdsAbsent([$target['cardId']], (array) $response->json('methodResponses.0.1.ids'), $case->key());
        $this->assertIdsAbsent([$target['cardId']], (array) $response->json('methodResponses.1.1.ids'), $case->key().' (no filter)');
        $unknown = $this->actorJmap($case, [$query($this->unknownBookId($target))]);
        $this->assertSame($unknown->json('methodResponses.0'), $response->json('methodResponses.0'), $case->key().': invisible and unknown books answer differently.');
    }

    /**
     * ContactCard/query does not calculate changes, so queryChanges answers
     * cannotCalculateChanges; the row proves that answer never depends on a
     * book the actor cannot see.
     *
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runCardQueryChanges(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $call = fn (string $bookId): array => ['ContactCard/queryChanges', [
            'accountId' => $account,
            'filter' => ['inAddressBook' => $bookId],
            'sinceQueryState' => '0',
        ], 'q'];
        $response = $this->actorJmap($case, [$call($target['actorBookId'])]);
        $entry = $response->json('methodResponses.0');
        $this->assertIsArray($entry, $case->key());

        if ($case->outcome === Outcome::Allowed) {
            if ($entry[0] === 'error') {
                $this->assertSame('cannotCalculateChanges', $entry[1]['type'] ?? null, $case->key().': '.json_encode($entry));

                return;
            }
            $this->assertContains($target['cardId'], array_column((array) ($entry[1]['added'] ?? []), 'id'), $case->key());

            return;
        }

        $this->assertStringNotContainsString($target['cardId'], (string) json_encode($entry), $case->key());
        $unknown = $this->actorJmap($case, [$call($this->unknownBookId($target))]);
        $this->assertSame($unknown->json('methodResponses.0'), $entry, $case->key().': invisible and unknown books answer differently.');
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runCardSet(OwnershipCase $case, array $target): void
    {
        $account = $this->actorAccount($case);
        $self = $this->usernameFor($case->actor);
        // The actor's own writable book other than the target.
        $homeBookId = $case->scope === Scope::OwnUser
            ? AddressBookCollectionUris::groupApiId(OwnershipPrincipals::CREW)
            : AddressBookCollectionUris::PERSONAL_DEFAULT;

        [$args, $operation, $id, $ownCardId] = match ($case->variant) {
            'create' => [['create' => ['n' => ['addressBookIds' => [$target['actorBookId'] => true], 'name' => ['full' => 'created by actor']]]], 'create', 'n', null],
            'update' => [['update' => [$target['cardId'] => ['name' => ['full' => 'patched by actor']]]], 'update', $target['cardId'], null],
            'destroy' => [['destroy' => [$target['cardId']]], 'destroy', $target['cardId'], null],
            'move-out' => [['update' => [$target['cardId'] => ['addressBookIds' => [$target['actorBookId'] => false, $homeBookId => true]]]], 'update', $target['cardId'], null],
            'move-in' => (function () use ($self, $homeBookId, $target): array {
                $own = $this->createCard($self, $homeBookId, 'own card');

                return [['update' => [$own => ['addressBookIds' => [$homeBookId => false, $target['actorBookId'] => true]]]], 'update', $own, $own];
            })(),
            default => throw new LogicException('No ContactCard/set variant '.$case->variant),
        };

        $response = $this->guardedWrite(
            $case,
            $target,
            fn (): TestResponse => $this->actorJmap($case, [['ContactCard/set', array_merge(['accountId' => $account], $args), 's']]),
        );
        $this->assertJmapSetOutcome($response, $operation, $id, $case);

        if ($ownCardId !== null && $case->outcome !== Outcome::Allowed) {
            $home = $this->actorJmap($case, [['ContactCard/query', ['accountId' => $account, 'filter' => ['inAddressBook' => $homeBookId]], 'q']]);
            $this->assertContains($ownCardId, (array) $home->json('methodResponses.0.1.ids'), $case->key().': card left the actor book.');
        }
    }

    /**
     * @param  array{owner: string, ownerBookId: string, actorBookId: string, bookPk: int, cardId: string, liveState: string}  $target
     */
    private function runImport(OwnershipCase $case, array $target): void
    {
        $response = $this->guardedWrite($case, $target, fn (): TestResponse => $this->importAs($case->actor, $target['actorBookId']));
        $this->assertRestOutcome($response, $case);
    }
}
