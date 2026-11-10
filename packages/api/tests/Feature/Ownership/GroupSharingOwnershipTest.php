<?php

declare(strict_types=1);

namespace Tests\Feature\Ownership;

use App\Models\Addressbook;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpFoundation\StreamedResponse;
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
use Tests\Support\WgwTestDisks;

/**
 * Ownership matrix for sharing and publishing group-owned collections (plan
 * chunk-s-group-sharing), across calendars, task lists, notebooks, chat
 * channels, address books and the group drive.
 *
 * Every target is a `crew` collection that dave created and that holds one
 * item. The actor is another crew member (member or admin):
 *
 * - `own-group | group-share`: the actor shares the collection with the
 *   `outsiders` group. carol reaches it, and not a second crew collection of
 *   the same kind.
 * - `group-to-nonmember-* | group-reach`: here the actor is the sharer and
 *   carol is the nonmember grantee, at read or write level. carol reaches
 *   exactly that collection (and may write only with the write grant), not
 *   the control collection of the same kind and, at read level, no crew
 *   collection of any other kind and nothing of the crew drive outside the
 *   shared folder.
 * - `own-group | group-publish*`: feed publish, show and revoke on a crew
 *   calendar; the public feed serves only that calendar.
 * - `own-group | group-take-personal`: the actor takes the collection out of
 *   the group. Removing a collection from the group needs the same right as
 *   deleting it (admin only). Notebooks have this row in the notes suite;
 *   address books (one per principal) and drive folders (paths, no owner
 *   field) have no owner transfer.
 *
 * Address books have one book per group, so contacts has no same-kind
 * control collection.
 */
final class GroupSharingOwnershipTest extends WgwDatabaseTestCase implements OwnershipSuite
{
    use OwnershipAssertions;
    use OwnershipWorld;
    use SendsFramedCollaboration;

    private const CALENDARS = 'calendars';

    private const TASKS = 'tasks';

    private const NOTES = 'notes';

    private const CHAT = 'chat';

    private const CONTACTS = 'contacts';

    private const DRIVE = 'drive';

    /** The share operation of each domain. */
    private const SHARE_OPS = [
        self::CALENDARS => 'JMAP Calendar/set',
        self::TASKS => 'PATCH /tasks/tasklists/{taskListId}',
        self::NOTES => 'PATCH /notes/notebooks/{notebookId}',
        self::CHAT => 'PATCH /chat/channels/{channelId}',
        self::CONTACTS => 'JMAP AddressBook/set',
        self::DRIVE => 'POST /files/shares',
    ];

    /** Domains whose collections can change owner. */
    private const TRANSFER_DOMAINS = [self::CALENDARS, self::TASKS, self::CHAT];

    private const FEED_GET = 'GET /calendars/{calendarId}/feed';

    private const FEED_POST = 'POST /calendars/{calendarId}/feed';

    private const FEED_DELETE = 'DELETE /calendars/{calendarId}/feed';

    private const USING_CALENDARS = [JmapCapabilities::CORE, JmapCapabilities::CALENDARS];

    private const USING_CONTACTS = [JmapCapabilities::CORE, JmapCapabilities::CONTACTS];

    private const START = '2030-01-15T10:00:00Z';

    private const END = '2030-01-15T11:00:00Z';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = storage_path('framework/testing/wgw-ownership-group-sharing-'.uniqid('', true));
        foreach (['users/member', 'users/admin', 'users/carol', 'users/dave', 'groups/crew', 'groups/outsiders', 'groups/alumni'] as $dir) {
            File::ensureDirectoryExists($this->dataDir.'/files/'.$dir);
        }
        WgwTestDisks::refresh($this->dataDir);
        $this->seedOwnershipWorld();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
        Mail::fake();
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

        foreach (Actor::signedIn() as $actor) {
            foreach (self::SHARE_OPS as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('group-share');
                $cases[] = OwnershipCase::of($op, $actor, Scope::GroupToNonmemberRead, Outcome::Allowed)->variant('group-reach');
                $cases[] = OwnershipCase::of($op, $actor, Scope::GroupToNonmemberWrite, Outcome::Allowed)->variant('group-reach');
            }

            foreach ([self::FEED_POST, self::FEED_GET, self::FEED_DELETE] as $op) {
                $cases[] = OwnershipCase::of($op, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('group-publish');
            }
            // A feed another crew member published.
            $cases[] = OwnershipCase::of(self::FEED_DELETE, $actor, Scope::OwnGroup, Outcome::Allowed)->variant('group-publish-peer');

            foreach (self::TRANSFER_DOMAINS as $domain) {
                $case = $actor === Actor::Member
                    ? OwnershipCase::of(self::SHARE_OPS[$domain], $actor, Scope::OwnGroup, Outcome::Forbidden)->withCode('group_delete_admin_only')
                    : OwnershipCase::of(self::SHARE_OPS[$domain], $actor, Scope::OwnGroup, Outcome::Allowed);
                $cases[] = $case->variant('group-take-personal');
            }
        }

        // The feed of a deleted group calendar must not serve a later calendar with the same id.
        $cases[] = OwnershipCase::of(self::FEED_POST, Actor::Member, Scope::OwnGroup, Outcome::Allowed)->variant('group-publish-reattach');

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
        match (true) {
            $case->variant === 'group-share' => $this->runGroupShare($case),
            $case->variant === 'group-reach' => $this->runGroupReach($case),
            $case->variant === 'group-take-personal' => $this->runTakePersonal($case),
            str_starts_with((string) $case->variant, 'group-publish') => $this->runPublish($case),
            default => throw new LogicException('No runner for '.$case->key()),
        };
    }

    private static function domainOf(OwnershipCase $case): string
    {
        $domain = array_search($case->operation, self::SHARE_OPS, true);
        if (! is_string($domain)) {
            throw new LogicException('No domain for '.$case->operation);
        }

        return $domain;
    }

    // ---- Runners ---------------------------------------------------------

    /**
     * The actor shares a crew collection with the outsiders group: carol
     * reaches it through her group, and only it.
     */
    private function runGroupShare(OwnershipCase $case): void
    {
        $domain = self::domainOf($case);
        $target = $this->seedCrew($domain, 'shared');
        $control = $domain === self::CONTACTS ? null : $this->seedCrew($domain, 'control');
        // Epic #1915: only a member of a Team may share with it.
        $this->seedSharedTeam(OwnershipPrincipals::OUTSIDERS, $this->usernameFor($case->actor));

        $this->assertShareResponse($case, $target, $this->shareAs($case->actor, $target, 'groups/'.OwnershipPrincipals::OUTSIDERS, write: false));

        $this->assertSame(['listed' => true, 'readable' => true], $this->reach($target), $case->key().': the share did not reach carol.');
        if ($control !== null) {
            $this->assertSame(['listed' => false, 'readable' => false], $this->reach($control), $case->key().': carol reaches a crew collection nobody shared.');
        }
    }

    /**
     * The actor shares one crew collection with carol. Her grant reaches that
     * collection at its level, and nothing else of crew.
     */
    private function runGroupReach(OwnershipCase $case): void
    {
        $domain = self::domainOf($case);
        $write = $case->scope === Scope::GroupToNonmemberWrite;
        $target = $this->seedCrew($domain, 'shared');
        $controls = [];
        foreach ($write ? [$domain] : array_keys(self::SHARE_OPS) as $kind) {
            if ($kind !== self::CONTACTS) {
                $controls[$kind] = $this->seedCrew($kind, 'control');
            }
        }
        if (! $write && $domain !== self::CONTACTS) {
            // The address book of crew is the target's group book, never shared here.
            $controls[self::CONTACTS] = $this->seedCrew(self::CONTACTS, 'control');
        }

        $this->assertShareResponse($case, $target, $this->shareAs($case->actor, $target, OwnershipPrincipals::CAROL, $write));

        $this->assertSame(['listed' => true, 'readable' => true], $this->reach($target), $case->key().': the share did not reach carol.');
        $this->assertCarolWrite($case, $target, $write ? 'allowed' : 'forbidden');

        foreach ($controls as $kind => $control) {
            $this->assertSame(['listed' => false, 'readable' => false], $this->reach($control), $case->key().': carol reaches the crew '.$kind.' control.');
        }
        if (isset($controls[$domain])) {
            $this->assertCarolWrite($case, $controls[$domain], 'denied');
        }
        if ($domain === self::DRIVE) {
            $root = $this->asCarol('GET', '/files/children?path='.rawurlencode('/groups/'.OwnershipPrincipals::CREW));
            $this->assertFalse($root->isSuccessful() && $this->entryNames($root) !== [], $case->key().': carol lists the crew drive root.');
        }
    }

    /**
     * Feed publish, show and revoke on a crew calendar.
     */
    private function runPublish(OwnershipCase $case): void
    {
        $target = $this->seedCrew(self::CALENDARS, 'published');
        $control = $this->seedCrew(self::CALENDARS, 'unpublished');
        $path = '/calendars/'.$target['id'].'/feed';

        if ($case->variant === 'group-publish-reattach') {
            $this->runPublishReattach($case, $target);

            return;
        }
        if ($case->variant === 'group-publish-peer') {
            $token = $this->publishAs(OwnershipPrincipals::DAVE, $target['id']);
            $this->assertRestOutcome($this->requestAs($case->actor, 'DELETE', $path), $case);
            $this->assertSame(404, $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$token)->getStatusCode(), $case->key().': the feed is still public.');

            return;
        }

        if ($case->operation === self::FEED_POST) {
            $response = $this->requestAs($case->actor, 'POST', $path);
            $this->assertRestOutcome($response, $case);
            $ics = (string) $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$this->tokenFrom($response))->assertOk()->getContent();
            $this->assertStringContainsString('SUMMARY:'.$target['itemTitle'], $ics, $case->key());
            $this->assertStringNotContainsString($control['itemTitle'], $ics, $case->key().': another crew calendar in the feed.');

            return;
        }

        $token = $this->publishAs($this->usernameFor($case->actor), $target['id']);
        $response = $this->requestAs($case->actor, $case->operation === self::FEED_GET ? 'GET' : 'DELETE', $path);
        $this->assertRestOutcome($response, $case);
        if ($case->operation === self::FEED_GET) {
            $this->assertSame($token, $this->tokenFrom($response), $case->key());

            return;
        }
        $this->assertSame(404, $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$token)->getStatusCode(), $case->key().': the feed is still public.');
    }

    /**
     * member publishes a crew calendar, admin deletes it, and dave creates a
     * new crew calendar with the same id. The old public URL serves nothing.
     *
     * @param  array<string, mixed>  $target
     */
    private function runPublishReattach(OwnershipCase $case, array $target): void
    {
        $response = $this->requestAs($case->actor, 'POST', '/calendars/'.$target['id'].'/feed');
        $this->assertRestOutcome($response, $case);
        $token = $this->tokenFrom($response);

        $admin = OwnershipPrincipals::ADMIN;
        $this->jmapUser($admin, self::USING_CALENDARS, [
            ['Calendar/set', ['accountId' => $admin, 'destroy' => [$target['id']], 'onDestroyRemoveEvents' => true], 'd'],
        ])->assertJsonPath('methodResponses.0.1.destroyed', [$target['id']]);
        $this->assertSame(404, $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$token)->getStatusCode(), $case->key().': the feed outlives its calendar.');

        $later = $this->seedCrew(self::CALENDARS, 'published', 'later event');
        $this->assertSame($target['id'], $later['id']);
        $feed = $this->requestAs(Actor::Anonymous, 'GET', '/calendars/feeds/'.$token);
        $this->assertStringNotContainsString('later event', (string) $feed->getContent(), $case->key().': the old feed serves a calendar nobody published.');
        $this->assertSame(404, $feed->getStatusCode(), $case->key());
    }

    /**
     * The actor takes a crew collection out of the group into its own account.
     */
    private function runTakePersonal(OwnershipCase $case): void
    {
        $domain = self::domainOf($case);
        $target = $this->seedCrew($domain, 'moved');
        $self = $this->usernameFor($case->actor);

        $send = function () use ($case, $domain, $target, $self): TestResponse {
            if ($domain === self::CALENDARS) {
                return $this->jmapAs($case->actor, [
                    ['Calendar/set', ['accountId' => $self, 'update' => [$target['id'] => ['groupSlug' => null]]], 'u'],
                ], self::USING_CALENDARS);
            }
            $uri = $domain === self::TASKS ? '/tasks/tasklists/'.$target['id'] : '/chat/channels/'.$target['id'];

            return $this->requestAs($case->actor, 'PATCH', $uri, ['groupSlug' => null]);
        };
        $assertOutcome = function (TestResponse $response) use ($case, $domain, $target): void {
            $domain === self::CALENDARS
                ? $this->assertJmapSetOutcome($response, 'update', $target['id'], $case)
                : $this->assertRestOutcome($response, $case);
        };

        if ($case->outcome !== Outcome::Allowed) {
            $assertOutcome($this->assertUnchanged(fn () => $this->ownerView($target, OwnershipPrincipals::DAVE), $send, $case->key()));

            return;
        }

        $assertOutcome($send());
        $this->assertFalse($this->ownerView($target, OwnershipPrincipals::DAVE)['found'], $case->key().': the collection is still in the group.');
        $mine = $this->ownerView($target, $self);
        $this->assertTrue($mine['found'], $case->key().': the actor does not own the collection.');
        $this->assertNull($mine['groupSlug'], $case->key());
        $this->assertSame([$target['itemId']], $mine['items'], $case->key().': items did not move with the collection.');
    }

    // ---- Seeding ----------------------------------------------------------

    /**
     * One crew collection created by dave, holding one item.
     *
     * @return array{domain: string, name: string, id: string, itemId: string, itemTitle: string, pk: int, folder: string, doc: string, body: string}
     */
    private function seedCrew(string $domain, string $tag, ?string $itemTitle = null): array
    {
        $dave = OwnershipPrincipals::DAVE;
        $crew = OwnershipPrincipals::CREW;
        $name = 'crew '.$domain.' '.$tag;
        $itemTitle ??= 'item of '.$name;
        $target = ['domain' => $domain, 'name' => $name, 'id' => '', 'itemId' => '', 'itemTitle' => $itemTitle, 'pk' => 0, 'folder' => '', 'doc' => '', 'body' => ''];

        switch ($domain) {
            case self::CALENDARS:
                $id = 'crew-'.$tag;
                $response = $this->jmapUser($dave, self::USING_CALENDARS, [
                    ['Calendar/set', ['accountId' => $dave, 'create' => ['c' => ['id' => $id, 'name' => $name, 'groupSlug' => $crew]]], 's0'],
                    ['CalendarEvent/set', ['accountId' => $dave, 'create' => ['e' => [
                        'calendarIds' => [$id => true], 'title' => $itemTitle, 'start' => self::START, 'end' => self::END,
                    ]]], 's1'],
                ]);
                $target['id'] = (string) $response->json('methodResponses.0.1.created.c.id');
                $target['itemId'] = (string) $response->json('methodResponses.1.1.created.e.id');
                break;
            case self::TASKS:
                $target['id'] = (string) $this->requestAsUsername($dave, 'POST', '/tasks/tasklists', ['name' => $name, 'groupSlug' => $crew])->assertCreated()->json('id');
                $target['itemId'] = (string) $this->requestAsUsername($dave, 'POST', '/tasks/items', [
                    'taskListIds' => [$target['id'] => true], 'title' => $itemTitle,
                ])->assertCreated()->json('id');
                break;
            case self::NOTES:
                $target['id'] = (string) $this->requestAsUsername($dave, 'POST', '/notes/notebooks', ['name' => $name, 'groupSlug' => $crew])->assertCreated()->json('id');
                $target['itemId'] = (string) $this->requestAsUsername($dave, 'POST', '/notes/items', [
                    'notebookId' => $target['id'], 'title' => $itemTitle, 'body' => 'body of '.$itemTitle,
                ])->assertCreated()->json('id');
                break;
            case self::CHAT:
                $target['id'] = (string) $this->requestAsUsername($dave, 'POST', '/chat/channels', ['name' => $name, 'kind' => 'channel', 'groupSlug' => $crew])->assertCreated()->json('id');
                $target['itemId'] = (string) Str::ulid();
                $this->requestAsUsername($dave, 'POST', '/chat/channels/'.$target['id'].'/messages', ['id' => $target['itemId'], 'body' => $itemTitle])->assertCreated();
                break;
            case self::CONTACTS:
                $target['id'] = AddressBookCollectionUris::groupApiId($crew);
                $response = $this->jmapUser($dave, self::USING_CONTACTS, [
                    ['ContactCard/set', ['accountId' => $dave, 'create' => ['t' => ['addressBookIds' => [$target['id'] => true], 'name' => ['full' => $itemTitle]]]], 'c'],
                ]);
                $target['itemId'] = (string) $response->json('methodResponses.0.1.created.t.id');
                $target['pk'] = (int) Addressbook::query()->where('principaluri', OwnershipPrincipals::groupUri($crew))->value('id');
                break;
            case self::DRIVE:
                $target['folder'] = '/groups/'.$crew.'/'.$tag;
                $target['doc'] = $target['folder'].'/doc-'.$tag.'.md';
                $target['body'] = '# '.$itemTitle."\n";
                $target['id'] = $target['folder'];
                $target['itemId'] = $target['doc'];
                app(WgwStorage::class)->files()->put(ltrim($target['doc'], '/'), $target['body']);
                break;
            default:
                throw new LogicException('Unknown domain '.$domain);
        }

        $this->assertNotSame('', $target['id'], 'Seeding '.$name);
        $this->assertNotSame('', $target['itemId'], 'Seeding item of '.$name);

        return $target;
    }

    // ---- Sharing ----------------------------------------------------------

    /**
     * @param  array<string, mixed>  $target
     */
    private function shareAs(Actor $actor, array $target, string $grantee, bool $write): TestResponse
    {
        $self = $this->usernameFor($actor);
        $id = (string) $target['id'];
        $rights = $write ? ['mayWriteAll' => true] : ['mayReadItems' => true];

        return match ($target['domain']) {
            self::CALENDARS => $this->jmapAs($actor, [
                ['Calendar/set', ['accountId' => $self, 'update' => [$id => ['shareWith' => [$grantee => $rights]]]], 's'],
            ], self::USING_CALENDARS),
            self::TASKS => $this->requestAs($actor, 'PATCH', '/tasks/tasklists/'.$id, ['shareWith' => [$grantee => $rights]]),
            self::NOTES => $this->requestAs($actor, 'PATCH', '/notes/notebooks/'.$id, ['shareWith' => [$grantee => $rights]]),
            self::CHAT => $this->requestAs($actor, 'PATCH', '/chat/channels/'.$id, ['shareWith' => [$grantee => $rights]]),
            self::CONTACTS => $this->jmapAs($actor, [
                ['AddressBook/set', ['accountId' => $self, 'update' => [$id => ['shareWith' => [$grantee => $write ? ['mayRead' => true, 'mayWrite' => true] : ['mayRead' => true]]]]], 's'],
            ], self::USING_CONTACTS),
            self::DRIVE => $this->requestAs($actor, 'POST', '/files/shares', [
                'path' => $id,
                'kind' => 'member',
                'defaultAccess' => 'view',
                'shareWith' => [$grantee => ['access' => $write ? 'edit' : 'view']],
            ]),
            default => throw new LogicException('Unknown domain '.$target['domain']),
        };
    }

    /**
     * @param  array<string, mixed>  $target
     */
    private function assertShareResponse(OwnershipCase $case, array $target, TestResponse $response): void
    {
        if (in_array($target['domain'], [self::CALENDARS, self::CONTACTS], true)) {
            $this->assertJmapSetOutcome($response, 'update', (string) $target['id'], $case);

            return;
        }
        $this->assertRestOutcome($response, $case);
    }

    // ---- carol's view -----------------------------------------------------

    /**
     * Whether carol lists the collection and can read its item.
     *
     * @param  array<string, mixed>  $target
     * @return array{listed: bool, readable: bool}
     */
    private function reach(array $target): array
    {
        $carol = OwnershipPrincipals::CAROL;

        switch ($target['domain']) {
            case self::CALENDARS:
                $response = $this->jmapUser($carol, self::USING_CALENDARS, [
                    ['Calendar/get', ['accountId' => $carol, 'ids' => null, 'properties' => ['id', 'name']], 'a'],
                    ['CalendarEvent/get', ['accountId' => $carol, 'ids' => [$target['itemId']], 'properties' => ['id', 'title']], 'b'],
                ]);
                $rows = (array) $response->json('methodResponses.0.1.list');

                return [
                    'listed' => $this->rowsMatch($rows, $target),
                    'readable' => in_array($target['itemId'], array_column((array) $response->json('methodResponses.1.1.list'), 'id'), true),
                ];
            case self::TASKS:
                return [
                    'listed' => $this->rowsMatch((array) $this->asCarol('GET', '/tasks/tasklists')->assertOk()->json('list'), $target),
                    'readable' => $this->asCarol('GET', '/tasks/items/'.$target['itemId'])->getStatusCode() === 200,
                ];
            case self::NOTES:
                return [
                    'listed' => $this->rowsMatch((array) $this->asCarol('GET', '/notes/notebooks')->assertOk()->json('list'), $target),
                    'readable' => $this->asCarol('GET', '/notes/items/'.$target['itemId'])->getStatusCode() === 200,
                ];
            case self::CHAT:
                $messages = $this->asCarol('GET', '/chat/channels/'.$target['id'].'/messages');

                return [
                    'listed' => $this->rowsMatch((array) $this->asCarol('GET', '/chat/channels')->assertOk()->json('list'), $target),
                    'readable' => $messages->getStatusCode() === 200
                        && in_array($target['itemId'], array_column((array) $messages->json('list'), 'id'), true),
                ];
            case self::CONTACTS:
                $response = $this->jmapUser($carol, self::USING_CONTACTS, [
                    ['AddressBook/get', ['accountId' => $carol, 'ids' => null], 'a'],
                    ['ContactCard/get', ['accountId' => $carol, 'ids' => [$target['itemId']]], 'b'],
                ]);
                $books = array_map('strval', array_column((array) $response->json('methodResponses.0.1.list'), 'id'));

                return [
                    'listed' => array_intersect($books, [$target['id'], AddressBookCollectionUris::sharedApiId((int) $target['pk'])]) !== [],
                    'readable' => in_array($target['itemId'], array_column((array) $response->json('methodResponses.1.1.list'), 'id'), true),
                ];
            case self::DRIVE:
                $shared = array_map('strval', array_column(array_column((array) $this->asCarol('GET', '/files/shared-with-me')->assertOk()->json('data'), 'share'), 'path'));
                $content = $this->asCarol('GET', '/files/content?path='.rawurlencode((string) $target['doc']));

                return [
                    'listed' => in_array($target['folder'], $shared, true),
                    'readable' => $content->isSuccessful() || str_contains($this->bodyOf($content), (string) $target['body']),
                ];
            default:
                throw new LogicException('Unknown domain '.$target['domain']);
        }
    }

    /**
     * Carol adds an item to the collection, addressed by the id she sees.
     * `denied` accepts any refusal; the owner's view must stay unchanged.
     *
     * @param  array<string, mixed>  $target
     * @param  'allowed'|'forbidden'|'denied'  $expected
     */
    private function assertCarolWrite(OwnershipCase $case, array $target, string $expected): void
    {
        $context = $case->key().': carol writes into '.$target['name'];
        $send = fn (): string => $this->carolWrite($target);

        if ($expected === 'allowed') {
            $before = $this->ownerView($target, OwnershipPrincipals::DAVE)['items'];
            $this->assertSame('allowed', $send(), $context);
            $this->assertNotSame($before, $this->ownerView($target, OwnershipPrincipals::DAVE)['items'], $context.': the write did not land.');

            return;
        }

        $result = $this->assertUnchanged(fn () => $this->ownerView($target, OwnershipPrincipals::DAVE), $send, $context);
        if ($expected === 'forbidden') {
            $this->assertSame('forbidden', $result, $context);

            return;
        }
        $this->assertNotSame('allowed', $result, $context);
    }

    /**
     * @param  array<string, mixed>  $target
     * @return string allowed, forbidden, notFound, or the raw status or error type
     */
    private function carolWrite(array $target): string
    {
        $carol = OwnershipPrincipals::CAROL;
        $id = $this->carolIdFor($target);
        $title = 'written by carol';

        switch ($target['domain']) {
            case self::CALENDARS:
                return $this->jmapCreateResult($this->jmapUser($carol, self::USING_CALENDARS, [
                    ['CalendarEvent/set', ['accountId' => $carol, 'create' => ['n' => [
                        'calendarIds' => [$id => true], 'title' => $title, 'start' => self::START, 'end' => self::END,
                    ]]], 'w'],
                ]));
            case self::CONTACTS:
                return $this->jmapCreateResult($this->jmapUser($carol, self::USING_CONTACTS, [
                    ['ContactCard/set', ['accountId' => $carol, 'create' => ['n' => ['addressBookIds' => [$id => true], 'name' => ['full' => $title]]]], 'w'],
                ]));
            case self::TASKS:
                return $this->restResult($this->asCarol('POST', '/tasks/items', ['taskListIds' => [$id => true], 'title' => $title]));
            case self::NOTES:
                return $this->restResult($this->asCarol('POST', '/notes/items', ['notebookId' => $id, 'title' => $title, 'body' => $title]));
            case self::CHAT:
                return $this->restResult($this->asCarol('POST', '/chat/channels/'.$id.'/messages', ['id' => (string) Str::ulid(), 'body' => $title]));
            case self::DRIVE:
                return $this->restResult($this->putCollaboration(
                    '/api/v1/files/collaboration?path='.rawurlencode((string) $target['doc']),
                    "# written by carol\n",
                    headers: $this->bearerHeaders($this->mintUserToken($carol, 'user')),
                ));
            default:
                throw new LogicException('Unknown domain '.$target['domain']);
        }
    }

    /**
     * The id carol uses for the collection: her copy when she has one, the
     * owner's id otherwise.
     *
     * @param  array<string, mixed>  $target
     */
    private function carolIdFor(array $target): string
    {
        $rows = match ($target['domain']) {
            self::TASKS => (array) $this->asCarol('GET', '/tasks/tasklists')->json('list'),
            self::NOTES => (array) $this->asCarol('GET', '/notes/notebooks')->json('list'),
            self::CALENDARS => (array) $this->jmapUser(OwnershipPrincipals::CAROL, self::USING_CALENDARS, [
                ['Calendar/get', ['accountId' => OwnershipPrincipals::CAROL, 'ids' => null, 'properties' => ['id', 'name']], 'a'],
            ])->json('methodResponses.0.1.list'),
            self::CONTACTS => [['id' => AddressBookCollectionUris::sharedApiId((int) $target['pk']), 'name' => $target['name']]],
            default => [],
        };
        foreach ($rows as $row) {
            if (is_array($row) && ($row['name'] ?? null) === $target['name']) {
                return (string) $row['id'];
            }
        }

        return (string) $target['id'];
    }

    /**
     * @param  list<mixed>|array<mixed>  $rows
     * @param  array<string, mixed>  $target
     */
    private function rowsMatch(array $rows, array $target): bool
    {
        foreach ($rows as $row) {
            if (is_array($row) && (($row['name'] ?? null) === $target['name'] || (string) ($row['id'] ?? '') === $target['id'])) {
                return true;
            }
        }

        return false;
    }

    // ---- Owner's view -----------------------------------------------------

    /**
     * A principal's view of the collection: whether it is found, its group,
     * and its item ids.
     *
     * @param  array<string, mixed>  $target
     * @return array{found: bool, groupSlug: mixed, items: list<string>}
     */
    private function ownerView(array $target, string $username): array
    {
        $id = (string) $target['id'];

        switch ($target['domain']) {
            case self::CALENDARS:
                $response = $this->jmapUser($username, self::USING_CALENDARS, [
                    ['Calendar/get', ['accountId' => $username, 'ids' => [$id], 'properties' => ['id', 'name', 'groupSlug']], 'a'],
                    ['CalendarEvent/query', ['accountId' => $username, 'filter' => ['inCalendars' => [$id]]], 'b'],
                ]);
                $list = (array) $response->json('methodResponses.0.1.list');

                return $this->collectionView($list !== [], $list[0]['groupSlug'] ?? null, (array) $response->json('methodResponses.1.1.ids'));
            case self::TASKS:
                $list = $this->requestAsUsername($username, 'GET', '/tasks/tasklists/'.$id);
                $items = $this->requestAsUsername($username, 'GET', '/tasks/items?taskListId='.urlencode($id));

                return $this->collectionView($list->getStatusCode() === 200, $list->json('groupSlug'), array_column((array) $items->json('list'), 'id'));
            case self::NOTES:
                $items = $this->requestAsUsername($username, 'GET', '/notes/items?notebookId='.urlencode($id));

                return $this->collectionView($items->getStatusCode() === 200, null, array_column((array) $items->json('list'), 'id'));
            case self::CHAT:
                $channel = $this->requestAsUsername($username, 'GET', '/chat/channels/'.$id);
                $messages = $this->requestAsUsername($username, 'GET', '/chat/channels/'.$id.'/messages');

                return $this->collectionView($channel->getStatusCode() === 200, $channel->json('groupSlug'), array_column((array) $messages->json('list'), 'id'));
            case self::CONTACTS:
                $response = $this->jmapUser($username, self::USING_CONTACTS, [
                    ['ContactCard/query', ['accountId' => $username, 'filter' => ['inAddressBook' => $id]], 'q'],
                ]);

                return $this->collectionView(true, null, (array) $response->json('methodResponses.0.1.ids'));
            case self::DRIVE:
                $children = $this->requestAsUsername($username, 'GET', '/files/children?path='.rawurlencode($id));
                $content = $this->requestAsUsername($username, 'GET', '/files/content?path='.rawurlencode((string) $target['doc']));

                return $this->collectionView($children->getStatusCode() === 200, null, [...$this->entryNames($children), $this->bodyOf($content)]);
            default:
                throw new LogicException('Unknown domain '.$target['domain']);
        }
    }

    /**
     * @param  array<mixed>  $items
     * @return array{found: bool, groupSlug: mixed, items: list<string>}
     */
    private function collectionView(bool $found, mixed $groupSlug, array $items): array
    {
        $items = array_map('strval', array_values($items));
        sort($items);

        return ['found' => $found, 'groupSlug' => $groupSlug, 'items' => $items];
    }

    // ---- Requests ---------------------------------------------------------

    /**
     * @param  array<string, mixed>  $data
     */
    private function asCarol(string $method, string $uri, array $data = []): TestResponse
    {
        return $this->requestAsUsername(OwnershipPrincipals::CAROL, $method, $uri, $data);
    }

    /**
     * @param  list<string>  $using
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapUser(string $username, array $using, array $methodCalls): TestResponse
    {
        return $this->requestAsUsername($username, 'POST', '/jmap', ['using' => $using, 'methodCalls' => $methodCalls])->assertOk();
    }

    private function publishAs(string $username, string $calendarId): string
    {
        return $this->tokenFrom($this->requestAsUsername($username, 'POST', '/calendars/'.$calendarId.'/feed')->assertSuccessful());
    }

    private function tokenFrom(TestResponse $response): string
    {
        $url = (string) $response->json('httpsUrl');
        $this->assertSame(1, preg_match('#/calendars/feeds/([A-Za-z0-9]+)$#', $url, $match), 'No feed URL: '.$response->getContent());

        return $match[1];
    }

    private function restResult(TestResponse $response): string
    {
        $status = $response->getStatusCode();

        return match (true) {
            $status >= 200 && $status < 300 => 'allowed',
            $status === 403 => 'forbidden',
            $status === 404 => 'notFound',
            default => 'status-'.$status,
        };
    }

    private function jmapCreateResult(TestResponse $response): string
    {
        if ($response->json('methodResponses.0.0') === 'error') {
            return 'error-'.$response->json('methodResponses.0.1.type');
        }
        if (is_array($response->json('methodResponses.0.1.created.n'))) {
            return 'allowed';
        }

        return (string) ($response->json('methodResponses.0.1.notCreated.n.type') ?? 'unknown');
    }

    private function bodyOf(TestResponse $response): string
    {
        return $response->baseResponse instanceof StreamedResponse
            ? (string) $response->streamedContent()
            : (string) $response->getContent();
    }

    /**
     * @return list<string>
     */
    private function entryNames(TestResponse $response): array
    {
        if ($response->getStatusCode() !== 200) {
            return [];
        }
        $names = array_map('strval', array_column((array) $response->json('data.files'), 'name'));
        sort($names);

        return $names;
    }
}
