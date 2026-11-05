<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Models\Addressbook;
use App\Services\Contacts\ContactCardKindFilter;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The ContactCard/query `kind` condition: only cards that mention a kind
 * marker are parsed, everything else counts as an individual.
 */
final class ContactCardKindFilterTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private const IDS = ['apple-group', 'company', 'group', 'kindness', 'location', 'person', 'unreadable'];

    private ContactCardKindFilter $filter;

    private int $bookId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->filter = app(ContactCardKindFilter::class);
        $this->bookId = (int) Addressbook::query()->where('principaluri', 'principals/bob')->firstOrFail()->id;

        $this->seedBobsCard('person', "FN:Plain Person\r\n");
        $this->seedBobsCard('kindness', "FN:Kind Person\r\nNOTE:Known for her kindness\r\n");
        $this->seedBobsCard('group', "KIND:group\r\nFN:Friends\r\nMEMBER:urn:uuid:person\r\n");
        $this->seedBobsCard('apple-group', "FN:Team\r\nX-ADDRESSBOOKSERVER-KIND:group\r\nX-ADDRESSBOOKSERVER-MEMBER:urn:uuid:person\r\n", '3.0');
        $this->seedBobsCard('company', "FN:Analytical Engines\r\nORG:Analytical Engines\r\nX-ABSHOWAS:COMPANY\r\n", '3.0');
        $this->seedBobsCard('location', "KIND:location\r\nFN:Head office\r\n");
        $this->seedCardViaPdo('bob', 'unreadable.vcf', "BEGIN:VCARD\r\nVERSION:4.0\r\nKIND:group\r\nEND:VCARD-ish\r\n");
    }

    /**
     * @return iterable<string, array{0: string, 1: list<string>}>
     */
    public static function kinds(): iterable
    {
        yield 'groups, RFC 6350 and Apple' => ['group', ['apple-group', 'group']];
        yield 'organizations from X-ABSHOWAS' => ['org', ['company']];
        yield 'other RFC 9553 kinds' => ['location', ['location']];
        yield 'individuals include unmarked, false-positive and unreadable cards' => ['individual', ['kindness', 'person', 'unreadable']];
        yield 'a kind nobody has' => ['device', []];
    }

    /**
     * @param  list<string>  $expected
     */
    #[DataProvider('kinds')]
    public function test_keep_returns_the_ids_of_one_kind_in_query_order(string $kind, array $expected): void
    {
        $this->assertSame($expected, $this->filter->keep($this->bookId, self::IDS, $kind));
    }

    public function test_keep_preserves_the_caller_order(): void
    {
        $this->assertSame(
            ['group', 'apple-group'],
            $this->filter->keep($this->bookId, ['person', 'group', 'apple-group'], 'group'),
        );
    }

    public function test_ids_from_another_book_count_as_individuals(): void
    {
        $this->seedCardViaPdo('carol', 'carols-group.vcf', "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:cg\r\nKIND:group\r\nFN:Carol's group\r\nEND:VCARD\r\n");

        $this->assertSame([], $this->filter->keep($this->bookId, ['carols-group'], 'group'));
        $this->assertSame(['carols-group'], $this->filter->keep($this->bookId, ['carols-group'], 'individual'));
    }

    public function test_every_rfc_kind_is_listed(): void
    {
        $this->assertSame(
            ['individual', 'group', 'org', 'location', 'device', 'application'],
            ContactCardKindFilter::KINDS,
        );
    }

    private function seedBobsCard(string $id, string $body, string $version = '4.0'): void
    {
        $this->seedCardViaPdo(
            'bob',
            $id.'.vcf',
            "BEGIN:VCARD\r\nVERSION:{$version}\r\nUID:urn:uuid:{$id}\r\n{$body}END:VCARD\r\n",
        );
    }
}
