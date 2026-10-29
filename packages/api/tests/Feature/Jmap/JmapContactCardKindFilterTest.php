<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * ContactCard/query `kind` filter (RFC 9610). The Contacts list sends a
 * kind=group query in its first request, so the header can count contacts
 * (every card that is not a group) before the cards download.
 */
final class JmapContactCardKindFilterTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @param  list<string>  $lines
     */
    private function vcard(array $lines): string
    {
        return "BEGIN:VCARD\r\nVERSION:4.0\r\n".implode("\r\n", $lines)."\r\nEND:VCARD\r\n";
    }

    /**
     * @return array{person: string, kindGroup: string, appleGroup: string, memberGroup: string, org: string}
     */
    private function seedKinds(): array
    {
        return [
            'person' => $this->seedCardViaPdo('bob', 'jane.vcf', $this->sampleVcard('Jane Doe')),
            'kindGroup' => $this->seedCardViaPdo('bob', 'team.vcf', $this->vcard([
                'UID:urn:uuid:team', 'FN:Team', 'KIND:group',
            ])),
            'appleGroup' => $this->seedCardViaPdo('bob', 'apple.vcf', $this->vcard([
                'UID:urn:uuid:apple-group', 'FN:Friends', 'X-ADDRESSBOOKSERVER-KIND:group',
            ])),
            'memberGroup' => $this->seedCardViaPdo('bob', 'members.vcf', $this->vcard([
                'UID:urn:uuid:member-group', 'FN:Club', 'MEMBER:urn:uuid:someone',
            ])),
            'org' => $this->seedCardViaPdo('bob', 'acme.vcf', $this->vcard([
                'UID:urn:uuid:acme', 'FN:Acme', 'ORG:Acme', 'X-ABSHOWAS:COMPANY',
            ])),
        ];
    }

    public function test_kind_group_returns_every_group_card_and_nothing_else(): void
    {
        $ids = $this->seedKinds();

        $response = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'group']], 'c0'],
        ])->assertOk();

        $this->assertEqualsCanonicalizing(
            [$ids['kindGroup'], $ids['appleGroup'], $ids['memberGroup']],
            $response->json('methodResponses.0.1.ids'),
        );
        $this->assertSame(3, $response->json('methodResponses.0.1.total'));
    }

    public function test_kind_matches_individuals_without_a_kind_line_and_orgs(): void
    {
        $ids = $this->seedKinds();

        $response = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'individual']], 'c0'],
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'org']], 'c1'],
        ])->assertOk();

        $this->assertSame([$ids['person']], $response->json('methodResponses.0.1.ids'));
        $this->assertSame([$ids['org']], $response->json('methodResponses.1.1.ids'));
    }

    public function test_kind_combines_with_in_address_book_and_windowing(): void
    {
        $ids = $this->seedKinds();

        $response = $this->jmap([
            ['ContactCard/query', [
                'accountId' => 'bob',
                'filter' => ['inAddressBook' => 'default', 'kind' => 'group'],
                'position' => 1,
                'limit' => 1,
            ], 'c0'],
        ])->assertOk();

        $this->assertCount(1, $response->json('methodResponses.0.1.ids'));
        $this->assertContains(
            $response->json('methodResponses.0.1.ids.0'),
            [$ids['kindGroup'], $ids['appleGroup'], $ids['memberGroup']],
        );
        $this->assertSame(3, $response->json('methodResponses.0.1.total'));
    }

    public function test_the_contacts_first_batch_gets_the_group_ids_beside_every_id(): void
    {
        $ids = $this->seedKinds();

        // The batch JmapContactsClient.getAddressBooksAndCards sends first.
        $response = $this->jmap([
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['ContactCard/query', ['accountId' => 'bob'], 'c1'],
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'group']], 'c2'],
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => []], 'c3'],
        ])->assertOk();

        $this->assertCount(5, $response->json('methodResponses.1.1.ids'));
        $this->assertEqualsCanonicalizing(
            [$ids['kindGroup'], $ids['appleGroup'], $ids['memberGroup']],
            $response->json('methodResponses.2.1.ids'),
        );
        $response->assertJsonPath('methodResponses.3.0', 'ContactCard/get');
    }

    public function test_a_marked_card_the_vcard_guard_rejects_does_not_fail_the_query(): void
    {
        $group = $this->seedCardViaPdo('bob', 'team.vcf', $this->vcard([
            'UID:urn:uuid:team', 'FN:Team', 'KIND:group',
        ]));
        $this->seedCardViaPdo('bob', 'huge.vcf', $this->vcard([
            'UID:urn:uuid:huge', 'FN:Huge', 'KIND:group', 'NOTE:'.str_repeat('a', 600 * 1024),
        ]));

        $response = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'group']], 'c0'],
        ])->assertOk();

        $this->assertSame([$group], $response->json('methodResponses.0.1.ids'));
    }

    public function test_kind_must_be_a_non_empty_string(): void
    {
        $response = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => '']], 'c0'],
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => ['group']]], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
        $response->assertJsonPath('methodResponses.1.1.type', 'invalidArguments');
    }
}
