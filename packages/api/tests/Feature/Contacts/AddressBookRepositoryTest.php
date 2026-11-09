<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookRepository;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * AddressBookRepository at the service boundary: listing, the owner and
 * sharee patch rules, dismissal and the collection-level change feed. The
 * JMAP tests cover the wire contract; these pin the repository behaviour a
 * shared CardDAV base must keep (#1639).
 */
final class AddressBookRepositoryTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private AddressBookRepository $books;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->books = app(AddressBookRepository::class);
    }

    public function test_owner_lists_the_personal_book_under_its_fixed_name(): void
    {
        $list = $this->books->list('bob')['list'];

        $this->assertCount(1, $list);
        $this->assertSame([
            'id' => AddressBookCollectionUris::PERSONAL_DEFAULT,
            'name' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
            'description' => null,
            'sortOrder' => (int) $this->bookRow('bob')->id,
            'isDefault' => true,
            'isSubscribed' => true,
            'isSharee' => false,
            'shareWith' => null,
            'myRights' => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => true, 'mayDelete' => false],
        ], $list[0]);
    }

    public function test_listing_provisions_a_personal_book_for_a_user_without_one(): void
    {
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->assertNull(Addressbook::query()->where('principaluri', 'principals/dave')->first());

        $list = $this->books->list('dave')['list'];

        $this->assertSame([AddressBookCollectionUris::PERSONAL_DEFAULT], array_column($list, 'id'));
        $this->assertSame(
            AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
            (string) $this->bookRow('dave')->displayname,
        );
    }

    public function test_group_member_lists_the_group_book_as_an_owned_non_default_book(): void
    {
        $this->bobJoinsGroup('team', 'Team');

        $list = $this->books->list('bob')['list'];
        $group = $this->entry($list, AddressBookCollectionUris::groupApiId('team'));

        $this->assertSame('Team', $group['name']);
        $this->assertFalse($group['isDefault']);
        $this->assertFalse($group['isSharee']);
        $this->assertTrue($group['myRights']['mayShare']);
    }

    public function test_show_maps_one_book_and_rejects_an_unknown_id(): void
    {
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DEFAULT, $this->books->show('bob', 'default')['id']);

        $this->assertApiError(404, 'not_found', fn () => $this->books->show('bob', 'nope'));
    }

    public function test_another_users_book_is_not_visible_without_a_share(): void
    {
        $carolBookId = (int) $this->bookRow('carol')->id;

        $this->assertApiError(404, 'not_found', fn () => $this->books->show('bob', AddressBookCollectionUris::sharedApiId($carolBookId)));
        $this->assertNotContains($carolBookId, $this->books->accessibleBookNumericIds('bob'));
    }

    public function test_creating_an_address_book_is_forbidden(): void
    {
        $this->assertApiError(403, 'forbidden', fn () => $this->books->create('bob', ['name' => 'Work']));
    }

    public function test_owner_cannot_rename_a_book(): void
    {
        $this->assertApiError(403, 'forbidden', fn () => $this->books->update('bob', 'default', ['name' => 'Work']));
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $this->books->show('bob', 'default')['name']);
    }

    public function test_owner_sets_and_clears_the_description(): void
    {
        $updated = $this->books->update('bob', 'default', ['description' => '  Clients  ']);
        $this->assertSame('Clients', $updated['description']);
        $this->assertSame('  Clients  ', (string) $this->bookRow('bob')->description);

        $cleared = $this->books->update('bob', 'default', ['description' => null]);
        $this->assertNull($cleared['description']);
    }

    public function test_a_blank_description_maps_to_null(): void
    {
        $this->assertNull($this->books->update('bob', 'default', ['description' => '   '])['description']);
    }

    public function test_a_description_change_moves_the_book_sync_token(): void
    {
        $before = $this->books->syncTokens('bob')['default'];

        $this->books->update('bob', 'default', ['description' => 'Clients']);

        $this->assertGreaterThan((int) $before, (int) $this->books->syncTokens('bob')['default']);
    }

    public function test_owner_shares_the_book_and_reads_the_grants_back(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $updated = $this->books->update('bob', 'default', [
            'shareWith' => ['carol' => ['mayRead' => true, 'mayWrite' => true]],
        ]);

        $this->assertSame(
            ['carol' => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => false]],
            $updated['shareWith'],
        );
    }

    public function test_share_with_null_removes_every_grant(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $this->shareBobsBookWith('carol');

        $updated = $this->books->update('bob', 'default', ['shareWith' => null]);

        $this->assertNull($updated['shareWith']);
        $this->assertSame([AddressBookCollectionUris::PERSONAL_DEFAULT], $this->withoutTeamBook(array_column($this->books->list('carol')['list'], 'id')));
    }

    public function test_share_with_an_unknown_principal_is_rejected(): void
    {
        $this->assertApiError(400, 'invalidProperties', fn () => $this->books->update('bob', 'default', [
            'shareWith' => ['nobody' => ['mayRead' => true]],
        ]));
    }

    public function test_sharee_sees_the_book_read_only_under_a_shared_id(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');

        $entry = $this->books->show('carol', $sharedId);

        $this->assertSame(AddressBookCollectionUris::sharedApiId((int) $this->bookRow('bob')->id), $sharedId);
        $this->assertTrue($entry['isSharee']);
        $this->assertFalse($entry['isDefault']);
        $this->assertNull($entry['shareWith']);
        $this->assertSame(['mayRead' => true, 'mayWrite' => false, 'mayShare' => false, 'mayDelete' => true], $entry['myRights']);
    }

    public function test_sharee_with_write_access_gets_may_write(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol', mayWrite: true);

        $this->assertTrue($this->books->show('carol', $sharedId)['myRights']['mayWrite']);
    }

    public function test_assert_writable_rejects_a_read_only_sharee(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $this->shareBobsBookWith('carol');
        $book = $this->bookRow('bob');

        $this->assertApiError(403, 'forbidden', fn () => $this->books->assertWritable('carol', $book));
        $this->books->assertWritable('bob', $book);
    }

    public function test_assert_writable_rejects_a_user_without_access(): void
    {
        $this->assertApiError(404, 'not_found', fn () => $this->books->assertWritable('carol', $this->bookRow('bob')));
    }

    public function test_sharee_cannot_change_owner_fields(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol', mayWrite: true);

        $this->assertApiError(403, 'forbidden', fn () => $this->books->update('carol', $sharedId, ['description' => 'Mine now']));
        $this->assertApiError(403, 'forbidden', fn () => $this->books->update('carol', $sharedId, ['shareWith' => null]));
        $this->assertNull($this->books->show('bob', 'default')['description']);
    }

    public function test_sharee_unsubscribes_and_resubscribes(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');

        $this->books->update('carol', $sharedId, ['isSubscribed' => false]);
        $this->assertNotContains($sharedId, array_column($this->books->list('carol')['list'], 'id'));

        $restored = $this->books->update('carol', $sharedId, ['isSubscribed' => true]);
        $this->assertSame($sharedId, $restored['id']);
        $this->assertContains($sharedId, array_column($this->books->list('carol')['list'], 'id'));
    }

    public function test_is_subscribed_must_be_a_boolean(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');

        $this->assertApiError(400, 'invalidProperties', fn () => $this->books->update('carol', $sharedId, ['isSubscribed' => 'no']));
    }

    public function test_resubscribing_after_the_grant_is_gone_finds_nothing(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');
        $this->books->delete('carol', $sharedId);
        $this->books->update('bob', 'default', ['shareWith' => null]);

        $this->assertApiError(404, 'not_found', fn () => $this->books->update('carol', $sharedId, ['isSubscribed' => true]));
    }

    public function test_sharee_delete_dismisses_and_owner_delete_is_forbidden(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');

        $this->assertSame(['ok' => true], $this->books->delete('carol', $sharedId));
        $this->assertNotContains($sharedId, array_column($this->books->list('carol')['list'], 'id'));
        $this->assertNotNull(Addressbook::query()->find((int) $this->bookRow('bob')->id), 'dismissing keeps the owner book');

        $this->assertApiError(403, 'forbidden', fn () => $this->books->delete('bob', 'default'));
    }

    public function test_sync_tokens_key_each_visible_book_by_its_api_id(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');

        $tokens = $this->books->syncTokens('carol');

        $this->assertSame([AddressBookCollectionUris::PERSONAL_DEFAULT, $sharedId], $this->withoutTeamBook(array_keys($tokens)));
        $this->assertSame((string) (int) $this->bookRow('bob')->synctoken, $tokens[$sharedId]);
    }

    public function test_api_ids_follow_the_viewer(): void
    {
        $this->seedSharedTeam('colleagues', 'alice', 'bob', 'carol');
        $sharedId = $this->shareBobsBookWith('carol');
        $book = $this->bookRow('bob');

        $this->assertSame('default', $this->books->apiIdFor($book));
        $this->assertSame('default', $this->books->viewerApiId('bob', $book));
        $this->assertSame($sharedId, $this->books->viewerApiId('carol', $book));
        $this->assertSame('default', $this->books->viewerApiId('dave-without-access', $book));
    }

    public function test_require_accessible_book_returns_the_row(): void
    {
        $this->assertSame((int) $this->bookRow('bob')->id, (int) $this->books->requireAccessibleBook('bob', 'default')->id);
        $this->assertApiError(404, 'not_found', fn () => $this->books->requireAccessibleBook('bob', 'shared-1'));
    }

    private function shareBobsBookWith(string $sharee, bool $mayWrite = false): string
    {
        $this->books->update('bob', 'default', [
            'shareWith' => [$sharee => ['mayRead' => true, 'mayWrite' => $mayWrite]],
        ]);

        return AddressBookCollectionUris::sharedApiId((int) $this->bookRow('bob')->id);
    }

    private function bobJoinsGroup(string $slug, string $name): void
    {
        $group = $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.$slug, $name);
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($group, $bob);
    }

    private function bookRow(string $username): Addressbook
    {
        return Addressbook::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->firstOrFail();
    }

    /**
     * @param  list<array<string, mixed>>  $list
     * @return array<string, mixed>
     */
    private function entry(array $list, string $id): array
    {
        foreach ($list as $entry) {
            if ($entry['id'] === $id) {
                return $entry;
            }
        }
        $this->fail('No address book '.$id.' in '.json_encode(array_column($list, 'id')));
    }

    private function assertApiError(int $status, string $code, \Closure $call): void
    {
        try {
            $call();
        } catch (ApiHttpException $e) {
            $this->assertSame($status, $e->getStatusCode(), $e->getMessage());
            $this->assertSame($code, $e->errorCode(), $e->getMessage());

            return;
        }
        $this->fail("Expected ApiHttpException {$status} {$code}.");
    }

    /**
     * Sharing needs a shared Team (Epic #1915), and that Team brings its own book.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function withoutTeamBook(array $ids): array
    {
        return array_values(array_diff($ids, [AddressBookCollectionUris::groupApiId('colleagues')]));
    }
}
