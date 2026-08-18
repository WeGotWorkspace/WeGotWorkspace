<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Contacts\MemberUriSanitizer;
use App\Services\Contacts\PropIdEnsurer;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Sabre\CardDAV\Backend\PDO as CardPDO;

/**
 * Shared CardDAV PDO fixtures for Contacts REST feature tests.
 */
trait ContactsTestFixtures
{
    use WgwRoleFixtures;

    protected function setUpContactsFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
        $this->seedContactsRoleMatrix();
    }

    protected function seedContactsRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);

        $this->seedDefaultAddressBookFor('bob');
        $this->seedDefaultAddressBookFor('carol');
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function seedDefaultAddressBookFor(string $username): void
    {
        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        $principalUri = 'principals/'.$username;

        foreach ($carddav->getAddressBooksForUser($principalUri) as $book) {
            if (($book['uri'] ?? '') === 'default') {
                return;
            }
        }

        $carddav->createAddressBook($principalUri, 'default', [
            '{DAV:}displayname' => 'Address book',
        ]);
    }

    protected function seedCardViaPdo(
        string $username,
        string $cardUri,
        string $vcard,
        string $bookUri = 'default',
    ): string {
        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        $bookId = $this->resolveAddressBookId($username, $bookUri);
        $carddav->createCard($bookId, $cardUri, $vcard);

        return str_ends_with($cardUri, '.vcf')
            ? substr($cardUri, 0, -4)
            : $cardUri;
    }

    protected function updateCardViaPdo(
        string $username,
        string $cardUri,
        string $vcard,
        string $bookUri = 'default',
    ): void {
        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        $bookId = $this->resolveAddressBookId($username, $bookUri);
        $cardUri = str_ends_with($cardUri, '.vcf') ? $cardUri : $cardUri.'.vcf';
        $carddav->updateCard($bookId, $cardUri, $vcard);
    }

    protected function ensurePropIdsOnStoredCard(
        string $username,
        string $cardUri,
        string $bookUri = 'default',
    ): void {
        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        $bookId = $this->resolveAddressBookId($username, $bookUri);
        $cardUri = str_ends_with($cardUri, '.vcf') ? $cardUri : $cardUri.'.vcf';
        $card = $carddav->getCard($bookId, $cardUri);
        if ($card === null) {
            throw new \RuntimeException("Card {$cardUri} not found for {$username}.");
        }
        $raw = is_string($card['carddata'] ?? null) ? $card['carddata'] : (string) ($card['carddata'] ?? '');
        $memberResult = (new MemberUriSanitizer)->sanitize($raw);
        if ($memberResult['changed']) {
            $raw = $memberResult['vcard'];
        }
        $propResult = (new PropIdEnsurer)->ensure($raw);
        if ($memberResult['changed'] || $propResult['changed']) {
            $carddav->updateCard($bookId, $cardUri, $propResult['changed'] ? $propResult['vcard'] : $raw);
        }
    }

    protected function sampleVcard(string $fullName = 'Jane Doe', ?string $uid = null): string
    {
        $uid ??= 'urn:uuid:'.Str::uuid()->toString();

        return "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:{$uid}\r\nFN:{$fullName}\r\nN:Doe;Jane;;;\r\nEMAIL:jane@example.com\r\nEND:VCARD\r\n";
    }

    /**
     * @return array<string, mixed>
     */
    protected function sampleContactCardPayload(string $bookId = 'default'): array
    {
        return [
            'addressBookIds' => [$bookId => true],
            'name' => [
                'full' => 'New Contact',
            ],
            'emails' => [
                '550e8400-e29b-41d4-a716-446655440001' => [
                    'address' => 'new@example.com',
                ],
            ],
        ];
    }

    /**
     * Strip server-owned response fields before using a ContactCard as a PUT body.
     *
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    protected function contactCardCreatePayloadFromResponse(array $card): array
    {
        unset($card['@type'], $card['version'], $card['id']);

        return $card;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    protected function jmapContacts(array $methodCalls, ?string $bearerToken = null): TestResponse
    {
        return $this->withBearer($bearerToken ?? $this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    protected function jmapGetContactCard(string $cardId, string $accountId = 'bob', ?string $bearerToken = null): array
    {
        $card = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => $accountId, 'ids' => [$cardId]], 'c0'],
        ], $bearerToken)->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertIsArray($card);

        return $card;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function jmapCreateContactCard(array $payload, string $accountId = 'bob', ?string $bearerToken = null): string
    {
        $cardId = $this->jmapContacts([
            ['ContactCard/set', ['accountId' => $accountId, 'create' => ['k0' => $payload]], 'c0'],
        ], $bearerToken)->assertOk()->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($cardId);

        return $cardId;
    }

    private function resolveAddressBookId(string $username, string $bookUri): int
    {
        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        foreach ($carddav->getAddressBooksForUser('principals/'.$username) as $book) {
            if (($book['uri'] ?? '') === $bookUri) {
                return (int) $book['id'];
            }
        }

        throw new \RuntimeException("Address book {$bookUri} not found for {$username}.");
    }
}
