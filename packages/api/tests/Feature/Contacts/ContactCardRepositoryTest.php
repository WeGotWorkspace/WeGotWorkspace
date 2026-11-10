<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\CardUid;
use App\Services\Contacts\ContactCardRepository;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * ContactCardRepository at the service boundary: create, read, query, edit,
 * move, delete, export, import and the per-book change feed, all through the
 * CardDAV backend the repository writes with. These pin the behaviour a shared
 * CardDAV base must keep (#1639); the JMAP tests cover the wire contract.
 */
final class ContactCardRepositoryTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private ContactCardRepository $cards;

    private AddressBookRepository $books;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->cards = app(ContactCardRepository::class);
        $this->books = app(AddressBookRepository::class);
        // Users here share with each other; Epic #1915 only lets colleagues share.
        $this->seedSharedTeamForEveryone();
    }

    public function test_create_stores_a_vcard_and_returns_the_mapped_card(): void
    {
        $card = $this->createJane();

        $this->assertMatchesRegularExpression('/^jane-doe-[0-9a-f]{8}$/', $card['id']);
        $this->assertSame(['default' => true], $card['addressBookIds']);
        $this->assertSame('Jane Doe', $card['name']['full']);
        $this->assertStringStartsWith('urn:uuid:', $card['uid']);
        $this->assertIsString($card['etag']);
        $this->assertSame($card['updated'], $card['created']);

        $stored = $this->storedCard($card['id']);
        $this->assertSame($card['id'].'.vcf', (string) $stored->uri);
        $this->assertStringContainsString('FN:Jane Doe', (string) $stored->carddata);
        $this->assertStringContainsString('jane@example.com', (string) $stored->carddata);
    }

    public function test_create_keeps_a_caller_uid(): void
    {
        $card = $this->createJane(['uid' => 'urn:uuid:11111111-2222-3333-4444-555555555555']);

        $this->assertSame('urn:uuid:11111111-2222-3333-4444-555555555555', $card['uid']);
    }

    public function test_create_ignores_a_caller_id_and_allocates_one(): void
    {
        $card = $this->createJane(['id' => 'chosen-by-client']);

        $this->assertNotSame('chosen-by-client', $card['id']);
    }

    public function test_a_card_without_a_name_gets_a_generic_id(): void
    {
        $card = $this->cards->create('bob', [
            'addressBookIds' => ['default' => true],
            'emails' => ['e1' => ['address' => 'nameless@example.com']],
        ]);

        $this->assertMatchesRegularExpression('/^(contact|nameless-example-com)-[0-9a-f]{8}$/', $card['id']);
    }

    /**
     * @return iterable<string, array{0: mixed}>
     */
    public static function missingBookSelections(): iterable
    {
        yield 'absent' => [null];
        yield 'empty' => [[]];
        yield 'all false' => [['default' => false]];
        yield 'not an object' => ['default'];
    }

    #[DataProvider('missingBookSelections')]
    public function test_create_requires_an_address_book(mixed $addressBookIds): void
    {
        $payload = ['name' => ['full' => 'Jane Doe']];
        if ($addressBookIds !== null) {
            $payload['addressBookIds'] = $addressBookIds;
        }

        $this->assertApiError(400, 'bad_request', fn () => $this->cards->create('bob', $payload));
    }

    public function test_create_in_an_unknown_book_is_not_found(): void
    {
        $this->assertApiError(404, 'not_found', fn () => $this->createJane(['addressBookIds' => ['work' => true]]));
    }

    public function test_create_in_a_read_only_shared_book_is_forbidden(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: false);

        $this->assertApiError(403, 'forbidden', fn () => $this->createJane(['addressBookIds' => [$sharedId => true]]));
        $this->assertSame(0, Card::query()->where('addressbookid', $this->bookId('carol'))->count());
    }

    public function test_create_in_a_writable_shared_book_lands_in_the_owners_book(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);

        $card = $this->createJane(['addressBookIds' => [$sharedId => true]]);

        $this->assertSame([$sharedId => true], $card['addressBookIds']);
        $this->assertSame($this->bookId('carol'), (int) $this->storedCard($card['id'])->addressbookid);
        $this->assertSame(['default' => true], $this->cards->show('carol', $card['id'])['addressBookIds']);
    }

    public function test_show_finds_a_card_by_id_or_by_uri(): void
    {
        $id = $this->createJane()['id'];

        $this->assertSame($id, $this->cards->show('bob', $id)['id']);
        $this->assertSame($id, $this->cards->show('bob', $id.'.vcf')['id']);
    }

    public function test_show_hides_cards_in_books_the_user_cannot_see(): void
    {
        $id = $this->createJane()['id'];

        $this->assertApiError(404, 'not_found', fn () => $this->cards->show('carol', $id));
        $this->assertApiError(404, 'not_found', fn () => $this->cards->show('bob', 'missing'));
    }

    public function test_list_returns_cards_in_uri_order_and_filters_by_uid(): void
    {
        $this->seedCardViaPdo('bob', 'b.vcf', $this->sampleVcard('B Person', 'urn:uuid:b'));
        $this->seedCardViaPdo('bob', 'a.vcf', $this->sampleVcard('A Person', 'urn:uuid:a'));

        $this->assertSame(['a', 'b'], array_column($this->cards->list('bob', 'default')['list'], 'id'));
        $this->assertSame(['b'], array_column($this->cards->list('bob', 'default', 'urn:uuid:b')['list'], 'id'));
        $this->assertSame([], $this->cards->list('bob', 'default', 'urn:uuid:none')['list']);
    }

    public function test_list_skips_a_stored_card_the_payload_guard_rejects(): void
    {
        $this->seedCardViaPdo('bob', 'ok.vcf', $this->sampleVcard('Fine Person'));
        $this->seedCardViaPdo('bob', 'huge.vcf', $this->oversizedVcard());

        $this->assertSame(['ok'], array_column($this->cards->list('bob', 'default')['list'], 'id'));
    }

    public function test_list_for_a_sharee_uses_the_shared_book_id(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: false);
        $this->seedCardViaPdo('carol', 'c.vcf', $this->sampleVcard('Carol Contact'));

        $list = $this->cards->list('bob', $sharedId)['list'];

        $this->assertSame(['c'], array_column($list, 'id'));
        $this->assertSame([$sharedId => true], $list[0]['addressBookIds']);
    }

    public function test_query_returns_ids_total_and_honours_the_limit(): void
    {
        foreach (['c', 'a', 'b'] as $name) {
            $this->seedCardViaPdo('bob', $name.'.vcf', $this->sampleVcard(strtoupper($name).' Person', 'urn:uuid:'.$name));
        }

        $this->assertSame(['ids' => ['a', 'b', 'c'], 'total' => 3], $this->cards->query('bob', ['inAddressBook' => 'default']));
        $this->assertSame(['ids' => ['a', 'b'], 'total' => 3], $this->cards->query('bob', ['inAddressBook' => 'default'], 2));
        $this->assertSame(['ids' => ['c'], 'total' => 1], $this->cards->query('bob', ['inAddressBook' => 'default', 'uid' => 'urn:uuid:c']));
    }

    public function test_query_requires_an_address_book_filter(): void
    {
        $this->assertApiError(400, 'bad_request', fn () => $this->cards->query('bob', []));
        $this->assertApiError(400, 'bad_request', fn () => $this->cards->query('bob', ['inAddressBook' => '  ']));
        $this->assertApiError(404, 'not_found', fn () => $this->cards->query('bob', ['inAddressBook' => 'work']));
    }

    public function test_update_requires_a_precondition(): void
    {
        $id = $this->createJane()['id'];

        $this->assertApiError(412, 'precondition_failed', fn () => $this->cards->update('bob', $id, ['name' => ['full' => 'Janet']]));
    }

    public function test_update_rejects_a_stale_etag(): void
    {
        $id = $this->createJane()['id'];

        $this->assertApiError(412, 'precondition_failed', fn () => $this->cards->update('bob', $id, ['name' => ['full' => 'Janet']], '"stale"'));
        $this->assertStringContainsString('FN:Jane Doe', (string) $this->storedCard($id)->carddata);
    }

    public function test_update_replaces_the_card_and_keeps_id_uid_and_book(): void
    {
        $created = $this->createJane();

        $updated = $this->cards->update('bob', $created['id'], [
            'uid' => $created['uid'],
            'name' => ['full' => 'Janet Doe'],
            'addressBookIds' => ['ignored' => true],
        ], $created['etag']);

        $this->assertSame($created['id'], $updated['id']);
        $this->assertSame($created['uid'], $updated['uid']);
        $this->assertSame(['default' => true], $updated['addressBookIds']);
        $this->assertSame('Janet Doe', $updated['name']['full']);
        $this->assertArrayNotHasKey('emails', $updated, 'a full update drops fields the payload leaves out');
        $this->assertNotSame($created['etag'], $updated['etag']);
    }

    public function test_update_in_a_read_only_shared_book_is_forbidden(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: false);
        $this->seedCardViaPdo('carol', 'c.vcf', $this->sampleVcard('Carol Contact'));
        $card = $this->cards->show('bob', 'c');

        $this->assertSame([$sharedId => true], $card['addressBookIds']);
        $this->assertApiError(403, 'forbidden', fn () => $this->cards->update('bob', 'c', ['name' => ['full' => 'Changed']], $card['etag']));
        $this->assertApiError(403, 'forbidden', fn () => $this->cards->patch('bob', 'c', ['name' => ['full' => 'Changed']], $card['etag']));
        $this->assertApiError(403, 'forbidden', fn () => $this->cards->delete('bob', 'c', $card['etag']));
    }

    public function test_patch_merges_into_the_stored_card(): void
    {
        $created = $this->createJane();

        $patched = $this->cards->patch('bob', $created['id'], ['name' => ['full' => 'Janet Doe']], $created['etag']);

        $this->assertSame('Janet Doe', $patched['name']['full']);
        $this->assertSame(['jane@example.com'], array_column(array_values($patched['emails']), 'address'));
    }

    public function test_patch_without_precondition_when_the_caller_waives_it(): void
    {
        $id = $this->createJane()['id'];

        $this->assertApiError(412, 'precondition_failed', fn () => $this->cards->patch('bob', $id, ['name' => ['full' => 'Janet Doe']]));

        $patched = $this->cards->patchWithPrecondition('bob', $id, ['name' => ['full' => 'Janet Doe']], requirePrecondition: false);
        $this->assertSame('Janet Doe', $patched['name']['full']);
    }

    public function test_patch_of_an_unknown_card_is_not_found(): void
    {
        $this->assertApiError(404, 'not_found', fn () => $this->cards->patchWithPrecondition('bob', 'missing', [], requirePrecondition: false));
        $this->assertApiError(404, 'not_found', fn () => $this->cards->update('bob', 'missing', [], '"x"'));
    }

    public function test_patch_naming_the_same_book_stays_in_place(): void
    {
        $created = $this->createJane();

        $patched = $this->patchNoPrecondition($created['id'], ['addressBookIds' => ['default' => true], 'name' => ['full' => 'Janet Doe']]);

        $this->assertSame(['default' => true], $patched['addressBookIds']);
        $this->assertSame($this->bookId('bob'), (int) $this->storedCard($created['id'])->addressbookid);
    }

    public function test_patch_moves_a_card_to_another_writable_book(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);
        $created = $this->createJane();

        $moved = $this->patchNoPrecondition($created['id'], ['addressBookIds' => ['default' => false, $sharedId => true]]);

        $this->assertSame($created['id'], $moved['id']);
        $this->assertSame([$sharedId => true], $moved['addressBookIds']);
        $this->assertSame($created['uid'], $moved['uid']);
        $this->assertSame($this->bookId('carol'), (int) $this->storedCard($created['id'])->addressbookid);
        $this->assertSame(1, Card::query()->where('uri', $created['id'].'.vcf')->count(), 'the source copy is gone');
    }

    public function test_moving_a_contact_drops_it_from_groups_in_the_source_book(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);
        $jane = $this->createJane();
        $john = $this->createJane(['name' => ['full' => 'John Roe'], 'uid' => 'urn:uuid:john']);
        $group = $this->cards->create('bob', [
            'addressBookIds' => ['default' => true],
            'kind' => 'group',
            'name' => ['full' => 'Friends'],
            'members' => [$jane['uid'] => true, $john['uid'] => true],
        ]);
        $this->assertCount(2, $group['members']);

        $this->patchNoPrecondition($jane['id'], ['addressBookIds' => [$sharedId => true]]);

        $this->assertSame([$john['uid'] => true], $this->cards->show('bob', $group['id'])['members']);
    }

    public function test_a_group_card_cannot_move_between_books(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);
        $group = $this->cards->create('bob', [
            'addressBookIds' => ['default' => true],
            'kind' => 'group',
            'name' => ['full' => 'Friends'],
        ]);

        $this->assertApiError(400, 'bad_request', fn () => $this->patchNoPrecondition($group['id'], ['addressBookIds' => [$sharedId => true]]));
    }

    public function test_a_move_to_a_read_only_book_is_forbidden(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: false);
        $id = $this->createJane()['id'];

        $this->assertApiError(403, 'forbidden', fn () => $this->patchNoPrecondition($id, ['addressBookIds' => [$sharedId => true]]));
        $this->assertSame($this->bookId('bob'), (int) $this->storedCard($id)->addressbookid);
    }

    public function test_a_move_needs_exactly_one_destination(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);
        $this->bobGetsAnotherWritableShare();
        $daveShared = AddressBookCollectionUris::sharedApiId($this->bookId('dave'));
        $id = $this->createJane()['id'];

        $this->assertApiError(400, 'bad_request', fn () => $this->patchNoPrecondition($id, ['addressBookIds' => ['default' => false]]));
        $this->assertApiError(400, 'bad_request', fn () => $this->patchNoPrecondition($id, ['addressBookIds' => [$sharedId => true, $daveShared => true]]));
    }

    public function test_a_move_onto_a_taken_uri_conflicts(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: true);
        $id = $this->createJane()['id'];
        $this->seedCardViaPdo('carol', $id.'.vcf', $this->sampleVcard('Someone Else'));

        $this->assertApiError(409, 'alreadyExists', fn () => $this->patchNoPrecondition($id, ['addressBookIds' => [$sharedId => true]]));
        $this->assertSame($this->bookId('bob'), (int) Card::query()->where('uri', $id.'.vcf')->orderBy('id')->firstOrFail()->addressbookid);
    }

    public function test_delete_removes_the_card_with_a_matching_etag(): void
    {
        $created = $this->createJane();

        $this->assertApiError(412, 'precondition_failed', fn () => $this->cards->delete('bob', $created['id']));
        $this->assertSame(['ok' => true], $this->cards->delete('bob', $created['id'], $created['etag']));

        $this->assertNull(Card::query()->where('uri', $created['id'].'.vcf')->first());
        $this->assertApiError(404, 'not_found', fn () => $this->cards->show('bob', $created['id']));
    }

    public function test_delete_without_precondition_when_waived(): void
    {
        $id = $this->createJane()['id'];

        $this->assertSame(['ok' => true], $this->cards->deleteWithPrecondition('bob', $id, requirePrecondition: false));
        $this->assertApiError(404, 'not_found', fn () => $this->cards->deleteWithPrecondition('bob', $id, requirePrecondition: false));
    }

    public function test_initial_changes_list_every_card_in_the_book(): void
    {
        $this->seedCardViaPdo('bob', 'a.vcf', $this->sampleVcard('A Person'));
        $this->seedCardViaPdo('bob', 'b.vcf', $this->sampleVcard('B Person'));

        $changes = $this->cards->changes('bob', 'default', null);

        $this->assertSame('0', $changes['oldState']);
        $this->assertEqualsCanonicalizing(['a', 'b'], $changes['created']);
        $this->assertSame([], $changes['updated']);
        $this->assertSame([], $changes['destroyed']);
        $this->assertSame((string) (int) Addressbook::query()->findOrFail($this->bookId('bob'))->synctoken, $changes['newState']);
    }

    public function test_changes_since_a_token_report_creates_updates_and_deletes(): void
    {
        $kept = $this->createJane();
        $gone = $this->createJane(['name' => ['full' => 'Gone Person'], 'uid' => 'urn:uuid:gone']);
        $since = $this->cards->changes('bob', 'default', null)['newState'];

        $this->cards->patch('bob', $kept['id'], ['name' => ['full' => 'Kept Person']], $kept['etag']);
        $this->cards->delete('bob', $gone['id'], $gone['etag']);
        $new = $this->createJane(['name' => ['full' => 'New Person'], 'uid' => 'urn:uuid:new']);

        $changes = $this->cards->changes('bob', 'default', $since);

        $this->assertSame($since, $changes['oldState']);
        $this->assertSame([$new['id']], $changes['created']);
        $this->assertSame([$kept['id']], $changes['updated']);
        $this->assertSame([$gone['id']], $changes['destroyed']);
    }

    public function test_a_book_metadata_change_is_not_a_card_change(): void
    {
        $since = $this->cards->changes('bob', 'default', null)['newState'];
        $this->books->update('bob', 'default', ['description' => 'Clients']);

        $changes = $this->cards->changes('bob', 'default', $since);

        $this->assertNotSame($since, $changes['newState']);
        $this->assertSame([], $changes['created']);
        $this->assertSame([], $changes['updated']);
        $this->assertSame([], $changes['destroyed']);
    }

    public function test_a_full_update_without_a_uid_mints_a_new_one(): void
    {
        $created = $this->createJane();

        $updated = $this->cards->update('bob', $created['id'], ['name' => ['full' => 'Janet Doe']], $created['etag']);

        $this->assertStringStartsWith('urn:uuid:', $updated['uid']);
        $this->assertNotSame($created['uid'], $updated['uid']);
    }

    /**
     * Sabre's CardDAV backend does not reject a token it never issued: a token
     * past the current one selects no change rows, so nothing is reported.
     */
    public function test_a_token_past_the_current_one_reports_no_changes(): void
    {
        $this->createJane();

        $changes = $this->cards->changes('bob', 'default', '999999');

        $this->assertSame('999999', $changes['oldState']);
        $this->assertSame([[], [], []], [$changes['created'], $changes['updated'], $changes['destroyed']]);
    }

    public function test_changes_for_an_unknown_book_are_not_found(): void
    {
        $this->assertApiError(404, 'not_found', fn () => $this->cards->changes('bob', 'work', null));
    }

    public function test_export_re_serializes_the_stored_card(): void
    {
        $this->seedCardViaPdo('bob', 'v3.vcf', "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:urn:uuid:v3\r\nFN:Old Format\r\nN:Format;Old;;;\r\nTEL;TYPE=CELL:+31 6 1234 5678\r\nEND:VCARD\r\n");

        $export = $this->cards->exportVcard('bob', 'v3');

        $this->assertSame('v3.vcf', $export['uri']);
        $this->assertStringContainsString("VERSION:3.0\r\n", $export['carddata'], 'the stored vCard version is kept');
        $this->assertStringContainsString("FN:Old Format\r\n", $export['carddata']);
        $this->assertSame(1, preg_match('/^(item\d+)\.TEL[^\r]*:\+31 6 1234 5678\r$/m', $export['carddata'], $match));
        $this->assertStringContainsString($match[1].".X-ABLABEL:Mobile\r\n", $export['carddata'], 'write-side Apple labels apply on export');
        $this->assertStringNotContainsString('X-ABLABEL', (string) $this->storedCard('v3')->carddata, 'export does not rewrite storage');
    }

    public function test_export_of_an_unknown_card_is_not_found(): void
    {
        $this->assertApiError(404, 'not_found', fn () => $this->cards->exportVcard('bob', 'missing'));
        $this->assertApiError(404, 'not_found', fn () => $this->cards->exportVcard('carol', $this->createJane()['id']));
    }

    public function test_import_creates_contacts_before_groups_so_members_resolve(): void
    {
        $text = "BEGIN:VCARD\r\nVERSION:4.0\r\nKIND:group\r\nUID:urn:uuid:grp\r\nFN:Team\r\nMEMBER:urn:uuid:m1\r\nEND:VCARD\r\n"
            .$this->sampleVcard('Member One', 'urn:uuid:m1');

        $result = $this->cards->importVcards('bob', $text, 'default');

        $this->assertSame([], $result['errors']);
        $this->assertSame(['individual', 'group'], array_map(
            static fn (array $card): string => (string) ($card['kind'] ?? 'individual'),
            $result['list'],
        ));
        $this->assertSame(['urn:uuid:m1' => true], $result['list'][1]['members']);
    }

    public function test_import_skips_empty_blocks_and_reports_a_duplicate_uid_by_index(): void
    {
        $this->createJane(['uid' => 'urn:uuid:taken']);
        $text = $this->sampleVcard('Fresh Person', 'urn:uuid:fresh')
            ."BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n"
            .$this->sampleVcard('Taken Person', 'urn:uuid:taken');

        $result = $this->cards->importVcards('bob', $text, 'default');

        $this->assertSame(['Fresh Person'], array_map(static fn (array $card): string => $card['name']['full'], $result['list']));
        $this->assertCount(1, $result['errors']);
        $this->assertSame(1, $result['errors'][0]['index'], 'the empty block is not counted');
        $this->assertSame('alreadyExists', $result['errors'][0]['code']);
        $this->assertSame(1, Card::query()->where('uid', CardUid::normalize('urn:uuid:taken'))->count(), 'the existing card is kept');
    }

    public function test_import_rejects_an_empty_or_oversized_payload(): void
    {
        $this->assertApiError(400, 'bad_request', fn () => $this->cards->importVcards('bob', "not a vcard\r\n", 'default'));

        config(['wgw.contacts.import_max_bytes' => 64]);
        $this->assertApiError(413, 'payload_too_large', fn () => $this->cards->importVcards('bob', $this->sampleVcard(), 'default'));
    }

    public function test_import_into_a_read_only_book_is_forbidden(): void
    {
        $sharedId = $this->shareCarolsBookWithBob(mayWrite: false);

        $this->assertApiError(403, 'forbidden', fn () => $this->cards->importVcards('bob', $this->sampleVcard(), $sharedId));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function createJane(array $overrides = []): array
    {
        return $this->cards->create('bob', array_replace([
            'addressBookIds' => ['default' => true],
            'name' => ['full' => 'Jane Doe'],
            'emails' => ['e1' => ['address' => 'jane@example.com']],
        ], $overrides));
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    private function patchNoPrecondition(string $id, array $patch): array
    {
        return $this->cards->patchWithPrecondition('bob', $id, $patch, requirePrecondition: false);
    }

    private function shareCarolsBookWithBob(bool $mayWrite): string
    {
        $this->books->update('carol', 'default', [
            'shareWith' => ['bob' => ['mayRead' => true, 'mayWrite' => $mayWrite]],
        ]);

        return AddressBookCollectionUris::sharedApiId($this->bookId('carol'));
    }

    private function bobGetsAnotherWritableShare(): void
    {
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedSharedTeam('colleagues', 'dave');
        $this->books->update('dave', 'default', [
            'shareWith' => ['bob' => ['mayRead' => true, 'mayWrite' => true]],
        ]);
    }

    private function bookId(string $username): int
    {
        return (int) Addressbook::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->firstOrFail()
            ->id;
    }

    private function storedCard(string $id): Card
    {
        return Card::query()->where('uri', $id.'.vcf')->firstOrFail();
    }

    private function oversizedVcard(): string
    {
        $note = str_repeat('x', (int) config('wgw.vobject.max_bytes', 1_048_576) + 1);

        return "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:huge\r\nFN:Huge\r\nNOTE:{$note}\r\nEND:VCARD\r\n";
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
}
