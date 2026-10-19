<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Models\Card;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A WGW contact edit patches the stored vCard instead of rebuilding it (#1418).
 * Input is a real Apple Contacts card (macOS 26.6.2) as the server stored it.
 */
final class ContactCardInPlaceUpdateTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private const FIXTURE = __DIR__.'/../../fixtures/Interop/RealClients/apple-contacts-macos26-card.stored.vcf';

    private const CARD_ID = 'apple-card';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $vcard = file_get_contents(self::FIXTURE);
        $this->assertIsString($vcard);
        $this->seedCardViaPdo('bob', self::CARD_ID.'.vcf', $vcard);
    }

    public function test_name_edit_keeps_everything_else_apple_wrote(): void
    {
        $this->updateCard(['name' => [
            '@type' => 'Name',
            'full' => 'Apple Renamed',
            'components' => [
                ['@type' => 'NameComponent', 'kind' => 'given', 'value' => 'Apple'],
                ['@type' => 'NameComponent', 'kind' => 'surname', 'value' => 'Renamed'],
            ],
        ]]);

        $stored = $this->unfold($this->storedVCard());
        $this->assertStringContainsString("FN:Apple Renamed\r\n", $stored);
        $this->assertStringContainsString("PRODID:-//Apple Inc.//macOS 26.6.2//EN\r\n", $stored);
        // Apple's label stays on its email, in Apple's group (CT-2, CT-3)
        $this->assertStringContainsString('ITEM1.EMAIL;TYPE=INTERNET,pref;', $stored);
        $this->assertStringContainsString("ITEM1.X-ABLABEL:Newsletter\r\n", $stored);
        $this->assertStringNotContainsString('GROUP=', $stored);
        // A year-less birthday stays year-less (CT-4)
        $this->assertStringContainsString('BDAY;X-APPLE-OMIT-YEAR=1604;', $stored);
        // Both addresses survive (CT-1 on write)
        $this->assertStringContainsString(';;Damrak 1;Amsterdam;;1012 LG;', $stored);
        $this->assertStringContainsString(';;Coolsingel 40;Rotterdam;;3011 AD;', $stored);
    }

    public function test_new_labelled_entry_does_not_collide_with_apple_groups(): void
    {
        $emails = $this->jmap([['ContactCard/get', ['accountId' => 'bob', 'ids' => [self::CARD_ID], 'properties' => ['emails']], 'g']])
            ->json('methodResponses.0.1.list.0.emails');
        $this->assertIsArray($emails);
        $emails['work-1'] = ['@type' => 'EmailAddress', 'address' => 'work@example.com', 'label' => 'Work stuff'];

        $this->updateCard(['emails' => $emails]);

        $stored = $this->unfold($this->storedVCard());
        $this->assertStringContainsString("ITEM1.X-ABLABEL:Newsletter\r\n", $stored);
        $this->assertSame(1, preg_match('/^(item\d+)\.EMAIL[^\r]*:work@example\.com\r$/mi', $stored, $match));
        $this->assertNotSame('item1', strtolower($match[1]));
        $this->assertStringContainsString($match[1].".X-ABLABEL:Work stuff\r\n", $stored);
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function updateCard(array $patch): void
    {
        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['ContactCard/set', ['accountId' => 'bob', 'update' => [self::CARD_ID => $patch]], 's']],
        ])->assertOk();
        $this->assertArrayHasKey(self::CARD_ID, (array) $response->json('methodResponses.0.1.updated'), (string) $response->getContent());
    }

    private function storedVCard(): string
    {
        return (string) Card::query()->where('uri', self::CARD_ID.'.vcf')->firstOrFail()->carddata;
    }

    private function unfold(string $vcard): string
    {
        return str_replace("\r\n ", '', $vcard);
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
}
