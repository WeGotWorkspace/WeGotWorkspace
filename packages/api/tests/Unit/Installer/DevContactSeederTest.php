<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\Addressbook;
use App\Models\Card;
use App\Models\JmapContactState;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Contacts\ContactCardMapper;
use App\Services\Installer\DevContactCatalog;
use App\Services\Installer\DevContactSeeder;
use App\Services\Installer\DevSeedGuard;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Sabre\CardDAV\Backend\PDO as CardPDO;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class DevContactSeederTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedWgwUser('admin', displayName: 'Admin');
    }

    public function test_full_catalog_has_one_thousand_cards_and_edge_names(): void
    {
        $cards = app(DevContactCatalog::class)->cards(DevContactCatalog::PROFILE_FULL);

        $this->assertCount(DevContactCatalog::FULL_TARGET, $cards);
        $this->assertCount(count($cards), array_unique(array_column($cards, 'uri')));
        $this->assertCount(count($cards), array_unique(array_column($cards, 'uid')));

        $blob = implode("\n", array_column($cards, 'vcard'));
        $this->assertStringContainsString('van der Berg', $blob);
        $this->assertStringContainsString('Ødegaard', $blob);
        $this->assertStringContainsString('Çelik', $blob);
        $this->assertStringContainsString('Éric', $blob);
        $this->assertStringContainsString('ORG:Northwind Traders', $blob);

        foreach ($cards as $card) {
            $this->assertStringEndsWith('@example.test', $card['email']);
            $this->assertMatchesRegularExpression(
                '/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
                $card['uid'],
            );
            $this->assertStringContainsString('VERSION:4.0', $card['vcard']);
            $this->assertStringContainsString('UID:'.$card['uid'], $card['vcard']);
        }

        $org = $this->cardContaining($cards, 'ORG:Northwind Traders');
        $this->assertDoesNotMatchRegularExpression('/^N:/m', str_replace("\r\n", "\n", $org['vcard']));

        $emailOnly = $this->cardContaining($cards, 'FN:dev-seed-contact-0006@example.test');
        $this->assertDoesNotMatchRegularExpression('/^N:/m', str_replace("\r\n", "\n", $emailOnly['vcard']));
    }

    public function test_full_catalog_rotates_family_names_across_given_names(): void
    {
        $cards = app(DevContactCatalog::class)->cards(DevContactCatalog::PROFILE_FULL);
        $fns = array_map(fn (array $card): string => $this->formattedName($card['vcard']), $cards);

        // 676 bulk given+family pairs, plus 4 fixed persons and 2 non-person cards.
        $this->assertCount(682, array_unique($fns));

        $families = [];
        for ($i = 0; $i < 26; $i++) {
            $families[] = $this->familyName($cards[6 + $i]['vcard']);
        }
        $this->assertSame(array_fill(0, 26, 'Adams'), $families);
        $this->assertSame('Bram Adams', $fns[7]);
        $this->assertSame('Anna Berg', $fns[32]);
    }

    public function test_count_below_fixed_cards_throws(): void
    {
        $this->expectException(RuntimeException::class);
        app(DevContactCatalog::class)->cards(DevContactCatalog::PROFILE_FULL, 5);
    }

    public function test_compact_seed_writes_into_the_personal_book_and_skips_on_rerun(): void
    {
        $first = $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
        $second = $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);

        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $first['created']);
        $this->assertSame(0, $first['skipped']);
        $this->assertSame(0, $second['created']);
        $this->assertSame($first['created'], $second['skipped']);
        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $this->seededCardCount());

        $book = $this->personalBook();
        $this->assertSame(AddressBookCollectionUris::CALDAV_URI, $book->uri);
        $this->assertSame(
            DevContactCatalog::COMPACT_TARGET,
            Card::query()->where('addressbookid', $book->id)->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')->count(),
        );
    }

    public function test_delete_step_is_in_the_sync_delta_and_recreate_collapses_to_added(): void
    {
        $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
        $book = $this->personalBook();
        $before = (int) $book->synctoken;

        $deleted = $this->exposedSeeder()->deleteForTest('admin');

        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $deleted);
        $book->refresh();
        $this->assertGreaterThan($before, (int) $book->synctoken);

        $afterDelete = $this->carddav()->getChangesForAddressBook((int) $book->id, (string) $before, 1);
        $this->assertNotNull($afterDelete);
        $this->assertCount(DevContactCatalog::COMPACT_TARGET, $afterDelete['deleted']);
        foreach ($afterDelete['deleted'] as $uri) {
            $this->assertStringStartsWith(DevContactCatalog::URI_PREFIX, $uri);
        }

        $recreated = $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $recreated['created']);

        $afterRecreate = $this->carddav()->getChangesForAddressBook((int) $book->id, (string) $before, 1);
        $this->assertNotNull($afterRecreate);
        $this->assertCount(DevContactCatalog::COMPACT_TARGET, $afterRecreate['added']);
        $this->assertSame([], $afterRecreate['deleted']);
        $this->assertSame(
            DevContactCatalog::COMPACT_TARGET,
            DB::connection('wgw')->table('addressbookchanges')
                ->where('addressbookid', $book->id)
                ->where('operation', 3)
                ->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')
                ->count(),
        );
    }

    public function test_force_drops_stale_jmap_state_rows(): void
    {
        $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
        $card = Card::query()->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')->first();
        $this->assertNotNull($card);

        JmapContactState::query()->create([
            'username' => 'admin',
            'card_id' => ContactCardMapper::cardIdFromUri((string) $card->uri),
            'address_book_uri' => AddressBookCollectionUris::CALDAV_URI,
            'card_uri' => (string) $card->uri,
            'state_token' => 'stale-seed-token',
            'etag' => (string) $card->etag,
        ]);

        $forced = $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT, force: true);

        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $forced['deleted']);
        $this->assertSame(DevContactCatalog::COMPACT_TARGET, $forced['created']);
        $this->assertSame(
            0,
            JmapContactState::query()
                ->where('username', 'admin')
                ->where('card_id', 'like', DevContactCatalog::URI_PREFIX.'%')
                ->count(),
        );
    }

    public function test_non_numeric_count_option_is_rejected(): void
    {
        $code = Artisan::call('wgw:contacts:seed-dev', [
            '--username' => 'admin',
            '--count' => 'abc',
        ]);

        $this->assertSame(1, $code);
        $this->assertStringContainsString(
            'Contacts seed count must be a positive integer.',
            Artisan::output(),
        );
        $this->assertStringNotContainsString('at least', Artisan::output());
        $this->assertSame(0, $this->seededCardCount());
    }

    public function test_numeric_count_option_seeds_that_many_cards(): void
    {
        $code = Artisan::call('wgw:contacts:seed-dev', [
            '--username' => 'admin',
            '--count' => '6',
        ]);

        $this->assertSame(0, $code);
        $this->assertSame(6, $this->seededCardCount());
    }

    public function test_seed_refuses_outside_local_or_testing(): void
    {
        $this->app['env'] = 'production';

        try {
            $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
            $this->fail('Expected seed to refuse production.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('outside local/testing', $e->getMessage());
        }

        $this->assertSame(0, $this->seededCardCount());
    }

    public function test_seed_refuses_docker_install_channel(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => 'docker']);

        try {
            $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
            $this->fail('Expected seed to refuse the Docker install channel.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('docker install channel', $e->getMessage());
        }

        $this->assertSame(0, $this->seededCardCount());
    }

    public function test_seed_refuses_zip_install_channel(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => 'zip']);

        try {
            $this->contactSeeder()->seed('admin', DevContactCatalog::PROFILE_COMPACT);
            $this->fail('Expected seed to refuse the ZIP install channel.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('zip install channel', $e->getMessage());
        }

        $this->assertSame(0, $this->seededCardCount());
    }

    private function contactSeeder(): DevContactSeeder
    {
        return app(DevContactSeeder::class);
    }

    private function exposedSeeder(): ExposedDevContactSeeder
    {
        return new ExposedDevContactSeeder(
            app(DevContactCatalog::class),
            app(AddressBookProvisioner::class),
            app(BestEffortSearchIndexSync::class),
            app(SearchIndexerService::class),
            app(DevSeedGuard::class),
        );
    }

    private function personalBook(): Addressbook
    {
        $book = Addressbook::query()
            ->where('principaluri', 'principals/admin')
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->first();
        $this->assertNotNull($book);

        return $book;
    }

    private function seededCardCount(): int
    {
        return Card::query()->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')->count();
    }

    private function formattedName(string $vcard): string
    {
        $normalized = str_replace("\r\n", "\n", $vcard);
        $this->assertSame(1, preg_match('/^FN:(.*)$/m', $normalized, $matches));

        return $matches[1];
    }

    private function familyName(string $vcard): string
    {
        $normalized = str_replace("\r\n", "\n", $vcard);
        $this->assertSame(1, preg_match('/^N:([^;]*);/m', $normalized, $matches));

        return $matches[1];
    }

    /**
     * @param  list<array{uri: string, uid: string, email: string, vcard: string}>  $cards
     * @return array{uri: string, uid: string, email: string, vcard: string}
     */
    private function cardContaining(array $cards, string $needle): array
    {
        foreach ($cards as $card) {
            if (str_contains($card['vcard'], $needle)) {
                return $card;
            }
        }

        $this->fail('Missing card containing '.$needle);
    }

    private function carddav(): CardPDO
    {
        return new CardPDO(DB::connection('wgw')->getPdo());
    }
}

final class ExposedDevContactSeeder extends DevContactSeeder
{
    public function deleteForTest(string $username): int
    {
        return $this->deleteSeededCards($username);
    }
}
