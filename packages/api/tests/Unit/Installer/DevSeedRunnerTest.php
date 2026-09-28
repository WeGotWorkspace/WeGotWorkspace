<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Installer\DevContactCatalog;
use App\Services\Installer\DevContactSeeder;
use App\Services\Installer\DevSeedGuard;
use App\Services\Installer\DevSeedRunner;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use RuntimeException;
use Tests\Support\WgwDatabaseTestCase;

final class DevSeedRunnerTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->seedWgwUser('admin', displayName: 'Admin');
    }

    public function test_large_profile_is_rejected_when_another_app_is_selected(): void
    {
        $runner = app(DevSeedRunner::class);

        foreach ([null, ['calendars'], ['notes'], ['calendars', 'contacts'], ['notes', 'contacts']] as $apps) {
            try {
                $runner->seed('admin', $apps, DevContactCatalog::PROFILE_LARGE);
                $this->fail('Expected profile large to be rejected.');
            } catch (RuntimeException $e) {
                $this->assertSame(
                    'Profile large is only supported by wgw:contacts:seed-dev (or contacts).',
                    $e->getMessage(),
                );
            }
        }
    }

    public function test_large_profile_is_forwarded_when_only_contacts_are_selected(): void
    {
        $seeder = new LargeProfileContactSeeder(
            app(DevContactCatalog::class),
            app(AddressBookProvisioner::class),
            app(BestEffortSearchIndexSync::class),
            app(SearchIndexerService::class),
            app(DevSeedGuard::class),
        );
        $this->app->instance(DevContactSeeder::class, $seeder);

        $results = app(DevSeedRunner::class)->seed('admin', ['contacts'], DevContactCatalog::PROFILE_LARGE);

        $this->assertSame(DevContactCatalog::PROFILE_LARGE, $seeder->profile);
        $this->assertSame([
            [
                'app' => 'contacts',
                'created' => 4,
                'skipped' => 0,
                'deleted' => 0,
            ],
        ], $results);

        $seeder->profile = null;
        app(DevSeedRunner::class)->seed('admin', ['contact'], DevContactCatalog::PROFILE_LARGE);
        $this->assertSame(DevContactCatalog::PROFILE_LARGE, $seeder->profile);
    }
}

final class LargeProfileContactSeeder extends DevContactSeeder
{
    public ?string $profile = null;

    public function seed(
        string $username,
        string $profile = DevContactCatalog::PROFILE_FULL,
        bool $force = false,
        ?int $count = null,
    ): array {
        $this->profile = $profile;

        return ['created' => 4, 'skipped' => 0, 'deleted' => 0];
    }
}
