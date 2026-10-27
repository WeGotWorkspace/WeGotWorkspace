<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Dav\Server\CardUidConflict;
use App\Dav\Server\WgwCardBackend;
use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\CardUid;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Contacts\ContactMemberResolver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1609: one address book never holds two cards with the same (normalized)
 * vCard UID (RFC 6352 §5.1). Other books may reuse it.
 */
final class ContactsCardUidUniquenessTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_importing_the_same_file_twice_keeps_one_card_and_reports_already_exists(): void
    {
        $vcard = $this->sampleVcard('Jane Doe', 'urn:uuid:11111111-1111-4111-8111-111111111111');

        $this->importVcf($vcard)->assertCreated()->assertJsonCount(1, 'list')->assertJsonCount(0, 'errors');
        $before = $this->bobCards()->sole();

        // Nothing new to import: the endpoint answers 400 with the errors.
        $this->importVcf($vcard)
            ->assertStatus(400)
            ->assertJsonCount(0, 'list')
            ->assertJsonCount(1, 'errors')
            ->assertJsonPath('errors.0.index', 0)
            ->assertJsonPath('errors.0.code', 'alreadyExists');

        $after = $this->bobCards()->sole();
        $this->assertSame($before->id, $after->id);
        $this->assertSame($before->etag, $after->etag, 'The existing card is not changed.');
    }

    public function test_import_reports_the_clashing_block_and_keeps_going(): void
    {
        $this->seedCardViaPdo('bob', 'existing.vcf', $this->sampleVcard('Existing', 'urn:uuid:22222222-2222-4222-8222-222222222222'));

        $file = $this->sampleVcard('First New', 'urn:uuid:33333333-3333-4333-8333-333333333333')
            .$this->sampleVcard('Clash', 'urn:uuid:22222222-2222-4222-8222-222222222222')
            .$this->sampleVcard('Second New', 'urn:uuid:44444444-4444-4444-8444-444444444444');

        $this->importVcf($file)
            ->assertCreated()
            ->assertJsonCount(2, 'list')
            ->assertJsonPath('list.0.name.full', 'First New')
            ->assertJsonPath('list.1.name.full', 'Second New')
            ->assertJsonCount(1, 'errors')
            ->assertJsonPath('errors.0.index', 1)
            ->assertJsonPath('errors.0.code', 'alreadyExists');
        $this->assertSame(3, $this->bobCards()->count());
    }

    public function test_create_with_an_existing_uid_returns_409_already_exists(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->seedCardViaPdo('bob', 'taken.vcf', $this->sampleVcard('Taken', $uid));

        try {
            $this->repository()->create('bob', ['uid' => $uid] + $this->sampleContactCardPayload());
            $this->fail('A second card with the same UID was created.');
        } catch (ApiHttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('alreadyExists', $e->errorCode());
        }
        $this->assertSame(1, $this->bobCards()->count());
    }

    public function test_uid_match_ignores_urn_prefix_and_case(): void
    {
        $this->seedCardViaPdo('bob', 'taken.vcf', $this->sampleVcard('Taken', 'urn:uuid:ABCDEF00-1111-4111-8111-111111111111'));

        $this->expectApiConflict(fn () => $this->repository()->create(
            'bob',
            ['uid' => 'abcdef00-1111-4111-8111-111111111111'] + $this->sampleContactCardPayload(),
        ));
    }

    public function test_jmap_create_with_an_existing_uid_is_not_created(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->seedCardViaPdo('bob', 'taken.vcf', $this->sampleVcard('Taken', $uid));

        $this->jmapContacts([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => ['uid' => $uid] + $this->sampleContactCardPayload()]], 'c0'],
        ])
            ->assertOk()
            ->assertJsonPath('methodResponses.0.1.created', [])
            ->assertJsonPath('methodResponses.0.1.notCreated.k0.type', 'invalidProperties')
            ->assertJsonPath('methodResponses.0.1.notCreated.k0.description', 'A contact with this UID already exists in this address book.');
        $this->assertSame(1, $this->bobCards()->count());
    }

    public function test_update_to_a_uid_held_by_another_card_returns_409(): void
    {
        $this->seedCardViaPdo('bob', 'first.vcf', $this->sampleVcard('First', 'urn:uuid:55555555-5555-4555-8555-555555555555'));
        $secondId = $this->seedCardViaPdo('bob', 'second.vcf', $this->sampleVcard('Second', 'urn:uuid:66666666-6666-4666-8666-666666666666'));

        $this->expectApiConflict(fn () => $this->repository()->patchWithPrecondition(
            'bob',
            $secondId,
            ['uid' => 'urn:uuid:55555555-5555-4555-8555-555555555555'],
            requirePrecondition: false,
        ));
        $this->assertSame(
            CardUid::normalize('urn:uuid:66666666-6666-4666-8666-666666666666'),
            $this->bobCards()->where('uri', 'second.vcf')->value('uid'),
        );
    }

    public function test_update_that_keeps_its_own_uid_is_accepted(): void
    {
        $cardId = $this->seedCardViaPdo('bob', 'self.vcf', $this->sampleVcard('Before', 'urn:uuid:77777777-7777-4777-8777-777777777777'));

        $updated = $this->repository()->patchWithPrecondition('bob', $cardId, ['name' => ['full' => 'After']], requirePrecondition: false);

        $this->assertSame('After', $updated['name']['full'] ?? null);
    }

    public function test_same_uid_in_two_address_books_is_accepted(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->createBobBook('work');
        $this->seedCardViaPdo('bob', 'home.vcf', $this->sampleVcard('Home Copy', $uid));

        $created = $this->repository()->create('bob', ['uid' => $uid] + $this->sampleContactCardPayload('work'));

        $this->assertSame($uid, $created['uid'] ?? null);
        $this->assertSame(2, Card::query()->where('uid', CardUid::normalize($uid))->count());
    }

    public function test_move_into_a_book_that_holds_the_uid_returns_409(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->createBobBook('work');
        $this->seedCardViaPdo('bob', 'in-work.vcf', $this->sampleVcard('Work Copy', $uid), 'work');
        $homeId = $this->seedCardViaPdo('bob', 'in-home.vcf', $this->sampleVcard('Home Copy', $uid));

        $this->expectApiConflict(fn () => $this->repository()->patchWithPrecondition(
            'bob',
            $homeId,
            ['addressBookIds' => ['work' => true]],
            requirePrecondition: false,
        ));
        $this->assertSame(1, $this->bobCards()->where('uri', 'in-home.vcf')->count(), 'The source card stays.');
    }

    public function test_backend_refuses_a_second_card_with_the_same_uid(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->seedCardViaPdo('bob', 'one.vcf', $this->sampleVcard('One', $uid));

        try {
            $this->seedCardViaPdo('bob', 'two.vcf', $this->sampleVcard('Two', $uid));
            $this->fail('The backend wrote a duplicate UID.');
        } catch (CardUidConflict $e) {
            $this->assertSame('addressbooks/bob/default/one.vcf', $e->existingPath());
        }
    }

    public function test_unique_index_rejects_a_duplicate_uid_written_past_the_backend(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->seedCardViaPdo('bob', 'winner.vcf', $this->sampleVcard('Winner', $uid));

        $this->expectException(QueryException::class);
        Card::query()->create([
            'addressbookid' => $this->bobBookId(),
            'carddata' => $this->sampleVcard('Racer', $uid),
            'uri' => 'racer.vcf',
            'size' => 1,
            'uid' => CardUid::normalize($uid),
        ]);
    }

    public function test_unique_index_violation_from_a_race_maps_to_a_conflict(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $this->seedCardViaPdo('bob', 'winner.vcf', $this->sampleVcard('Winner', $uid));
        $violation = new \PDOException('UNIQUE constraint failed: cards.addressbookid, cards.uid');
        $violation->errorInfo = ['23000', 19, 'UNIQUE constraint failed'];
        $backend = WgwCardBackend::fromConnection();

        $conflict = $backend->conflictForWriteError($violation, $this->bobBookId(), CardUid::normalize($uid));

        $this->assertInstanceOf(CardUidConflict::class, $conflict);
        $this->assertSame('winner.vcf', $conflict->existingCardUri());
        $this->assertNull(
            $backend->conflictForWriteError($violation, $this->bobBookId(), 'some-other-uid'),
            'A violation of another constraint is not a UID conflict.',
        );
    }

    public function test_uid_lookups_use_the_stored_column(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $cardId = $this->seedCardViaPdo('bob', 'member.vcf', $this->sampleVcard('Member', $uid));
        $this->seedCardViaPdo('bob', 'other.vcf', $this->sampleVcard('Other'));

        $list = $this->repository()->list('bob', 'default', strtoupper($uid));
        $this->assertCount(1, $list['list']);
        $this->assertSame($cardId, $list['list'][0]['id'] ?? null);

        $query = $this->repository()->query('bob', ['inAddressBook' => 'default', 'uid' => $uid]);
        $this->assertSame(['ids' => [$cardId], 'total' => 1], $query);

        $resolved = (new ContactMemberResolver)->apply('bob', ['members' => [$uid => true]]);
        $this->assertSame([$uid => $cardId], $resolved['memberCardIds'] ?? null);
    }

    private function importVcf(string $vcard): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $vcard,
        );
    }

    private function expectApiConflict(callable $write): void
    {
        try {
            $write();
            $this->fail('Expected a 409 alreadyExists.');
        } catch (ApiHttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('alreadyExists', $e->errorCode());
        }
    }

    private function createBobBook(string $uri): void
    {
        WgwCardBackend::fromConnection()->createAddressBook('principals/bob', $uri, ['{DAV:}displayname' => ucfirst($uri)]);
    }

    private function bobBookId(): int
    {
        return (int) Addressbook::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', 'default')
            ->value('id');
    }

    /**
     * @return Builder<Card>
     */
    private function bobCards(): Builder
    {
        return Card::query()->where('addressbookid', $this->bobBookId());
    }

    private function repository(): ContactCardRepository
    {
        return app(ContactCardRepository::class);
    }
}
