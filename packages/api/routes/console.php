<?php

use App\Services\Calendars\DefaultCalendarColorMigrator;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Contacts\GroupMemberUriBackfill;
use App\Services\Installer\DevCalendarEventCatalog;
use App\Services\Installer\DevCalendarEventSeeder;
use App\Services\Installer\DevInstallBootstrap;
use App\Services\Installer\DevNoteCatalog;
use App\Services\Installer\DevNoteSeeder;
use App\Services\Installer\DevSeedRunner;
use App\Services\Installer\InstallerJwtKeyGenerator;
use App\Services\Installer\ProductionInstallBootstrap;
use App\Services\Installer\WgwConfigMigrator;
use App\Services\Installer\WgwSchemaMigrator;
use App\Services\Jmap\Blobs\JmapBlobGarbageCollector;
use App\Services\Jmap\FileNodes\FileNodeIndexService as JmapFileNodeIndexService;
use App\Services\Meet\MeetReservationService;
use App\Services\Notes\EventCalendarJournalStripper;
use App\Services\Notes\NotesFileMigrator;
use App\Services\Tasks\DefaultMixedCalendarMigrator;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('wgw:schema-migrate', function (WgwSchemaMigrator $migrator): int {
    $before = $migrator->currentVersion();
    $migrator->migrate();
    $after = $migrator->currentVersion();

    if ($after === $before) {
        $this->info("WGW schema already at version {$after}.");

        return self::SUCCESS;
    }

    $this->info("WGW schema migrated {$before} → {$after}.");

    return self::SUCCESS;
})->purpose('Apply pending database/migrations/wgw migrations on the wgw connection');

Artisan::command('wgw:jwt-keys', function (InstallerJwtKeyGenerator $jwtKeys): int {
    $jwtKeys->ensureKeys();
    $this->info('JWT signing keys are ready under the install data directory (wgw-content/keys/).');

    return self::SUCCESS;
})->purpose('Create RSA JWT signing keys for local dev when missing (idempotent)');

Artisan::command('wgw:dev-install', function (DevInstallBootstrap $bootstrap): int {
    $fresh = $bootstrap->ensure();
    if ($fresh) {
        $user = strtolower(trim((string) (getenv('WGW_DEV_USERNAME') ?: 'admin')));
        $this->info("Local dev install ready (admin user: {$user}, default password: storybook-dev).");
    } else {
        $this->info('Local dev install already present — skipped.');
    }

    return self::SUCCESS;
})->purpose('Bootstrap packages/api/.env WGW_* keys, SQLite, and admin user for Docker-free dev/preview (idempotent)');

Artisan::command('wgw:config-migrate', function (WgwConfigMigrator $migrator): int {
    if (! $migrator->migrateIfNeeded()) {
        $this->info('No legacy wgw-config.php found — nothing to migrate.');

        return self::SUCCESS;
    }

    $this->info('Migrated wgw-config.php to packages/api/.env (backup kept, legacy file removed).');

    return self::SUCCESS;
})->purpose('One-shot migration from legacy wgw-config.php to WGW_* keys in packages/api/.env');

Artisan::command('wgw:install', function (ProductionInstallBootstrap $bootstrap): int {
    try {
        $result = $bootstrap->run('');
    } catch (RuntimeException $e) {
        $this->error($e->getMessage());

        return self::FAILURE;
    }

    return match ($result) {
        'installed' => tap(self::SUCCESS, fn () => $this->info('Headless install complete.')),
        'skipped' => tap(self::SUCCESS, fn () => $this->info('Already installed — skipped.')),
        'incomplete' => tap(self::SUCCESS, fn () => $this->comment('Install env incomplete or headless disabled — wizard will run.')),
    };
})->purpose('Production headless install when WGW_INSTALL_HEADLESS=1 and required WGW_INSTALL_* vars are set');

Artisan::command('wgw:contacts:sanitize-group-member-uris', function (GroupMemberUriBackfill $backfill): int {
    $result = $backfill->run();
    $this->info(sprintf(
        'Scanned %d group card(s); updated %d with normalized member URIs.',
        $result['scanned'],
        $result['updated'],
    ));

    return self::SUCCESS;
})->purpose('Repair macOS-corrupt group member URIs in stored contact vCards');

Artisan::command('wgw:tasks:provision-inbox', function (InboxTaskListProvisioner $provisioner): int {
    $result = $provisioner->ensureForAllUsers();
    $this->info(sprintf(
        'Scanned %d user(s); created Inbox for %d; skipped %d (already present).',
        $result['scanned'],
        $result['created'],
        $result['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Ensure each user has a VTODO-only Inbox task list (idempotent)');

Artisan::command('wgw:tasks:migrate-default-vtodos', function (DefaultMixedCalendarMigrator $migrator): int {
    $result = $migrator->migrateAllUsers();
    $this->info(sprintf(
        'Scanned %d user(s); migrated %d mixed default calendar(s); moved %d VTODO object(s); skipped %d.',
        $result['scanned'],
        $result['migrated'],
        $result['movedObjects'],
        $result['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Move VTODOs from mixed default calendars into Inbox and strip VTODO from default (idempotent)');

Artisan::command('wgw:calendars:migrate-default-colors', function (DefaultCalendarColorMigrator $migrator): int {
    $result = $migrator->migrateAll();
    $this->info(sprintf(
        'Scanned %d provisioned calendar(s); updated %d; skipped %d.',
        $result['scanned'],
        $result['updated'],
        $result['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Assign distinct colors to provisioned calendars still on the shared default (idempotent)');

Artisan::command('wgw:calendars:provision-collections', function (UserCalendarCollectionsProvisioner $provisioner): int {
    $users = $provisioner->ensureForAllUsers();
    $groups = $provisioner->ensureForAllGroups();
    $this->info(sprintf(
        'Users: scanned %d, created %d collection(s), skipped %d.',
        $users['scanned'],
        $users['created'],
        $users['skipped'],
    ));
    $this->info(sprintf(
        'Groups: scanned %d, created %d calendar(s), skipped %d.',
        $groups['scanned'],
        $groups['created'],
        $groups['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Provision home/work VEVENT calendars, VTODO lists, VJOURNAL notebooks, and group collections (idempotent)');

Artisan::command('wgw:contacts:provision-address-books', function (AddressBookProvisioner $provisioner): int {
    $users = $provisioner->ensureForAllUsers();
    $groups = $provisioner->ensureForAllGroups();
    $this->info(sprintf(
        'Users: scanned %d, created %d address book(s), skipped %d.',
        $users['scanned'],
        $users['created'],
        $users['skipped'],
    ));
    $this->info(sprintf(
        'Groups: scanned %d, created %d address book(s), skipped %d.',
        $groups['scanned'],
        $groups['created'],
        $groups['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Provision one address book per user and group principal (idempotent)');

Artisan::command('wgw:notes:migrate-files', function (NotesFileMigrator $migrator): int {
    $result = $migrator->migrate();
    $this->info(sprintf(
        'Mapped %d path(s); imported %d; starred %d; skipped %d; discarded %d yjs; images %d.',
        $result['mapped'],
        $result['imported'],
        $result['starred'],
        $result['skipped'],
        $result['discardedYjs'],
        $result['images'],
    ));
    foreach ($result['notices'] as $notice) {
        $this->line($notice);
    }

    return self::SUCCESS;
})->purpose('One-way import of Drive .notes markdown into VJOURNAL notebooks');

Artisan::command('wgw:notes:strip-event-journals', function (EventCalendarJournalStripper $stripper): int {
    $result = $stripper->stripAll();
    $this->info(sprintf(
        'Scanned %d calendar(s); stripped VJOURNAL from %d; moved %d journal object(s); skipped %d.',
        $result['scanned'],
        $result['stripped'],
        $result['movedObjects'],
        $result['skipped'],
    ));

    return self::SUCCESS;
})->purpose('Strip VJOURNAL from event calendars and move stray journals into notes-general (idempotent)');

Artisan::command('wgw:calendars:seed-dev {--force} {--username=} {--profile=}', function (DevCalendarEventSeeder $seeder): int {
    $username = strtolower(trim((string) ($this->option('username') ?: (getenv('WGW_DEV_USERNAME') ?: 'admin'))));
    $profile = strtolower(trim((string) ($this->option('profile') ?: DevCalendarEventCatalog::PROFILE_FULL)));
    if ($profile === '') {
        $profile = DevCalendarEventCatalog::PROFILE_FULL;
    }

    try {
        $result = $seeder->seed($username, $profile, (bool) $this->option('force'));
    } catch (RuntimeException $e) {
        $this->error($e->getMessage());

        return self::FAILURE;
    }

    $this->info(sprintf(
        'Seeded calendar events for %s (%s): created %d, skipped %d, deleted %d [%s].',
        $username,
        $profile,
        $result['created'],
        $result['skipped'],
        $result['deleted'],
        (string) config('database.connections.wgw.database'),
    ));

    return self::SUCCESS;
})->purpose('Seed hundreds of local-dev calendar events for the admin user (idempotent; --force recreates)');

Artisan::command('wgw:notes:seed-dev {--force} {--username=} {--profile=}', function (DevNoteSeeder $seeder): int {
    $username = strtolower(trim((string) ($this->option('username') ?: (getenv('WGW_DEV_USERNAME') ?: 'admin'))));
    $profile = strtolower(trim((string) ($this->option('profile') ?: DevNoteCatalog::PROFILE_FULL)));
    if ($profile === '') {
        $profile = DevNoteCatalog::PROFILE_FULL;
    }

    try {
        $result = $seeder->seed($username, $profile, (bool) $this->option('force'));
    } catch (RuntimeException $e) {
        $this->error($e->getMessage());

        return self::FAILURE;
    }

    $this->info(sprintf(
        'Seeded notes for %s (%s): created %d, skipped %d, deleted %d, starred %d, notebooks+%d [%s].',
        $username,
        $profile,
        $result['created'],
        $result['skipped'],
        $result['deleted'],
        $result['starred'],
        $result['notebooks'],
        (string) config('database.connections.wgw.database'),
    ));

    return self::SUCCESS;
})->purpose('Seed ~1000 local-dev VJOURNAL notes for the admin user (idempotent; --force recreates)');

Artisan::command('wgw:seed-dev {apps?*} {--force} {--username=} {--profile=}', function (DevSeedRunner $runner): int {
    $username = strtolower(trim((string) ($this->option('username') ?: (getenv('WGW_DEV_USERNAME') ?: 'admin'))));
    $profile = strtolower(trim((string) ($this->option('profile') ?: 'full')));
    if ($profile === '') {
        $profile = 'full';
    }
    /** @var list<string> $apps */
    $apps = array_values(array_filter(
        array_map(static fn (mixed $app): string => strtolower(trim((string) $app)), (array) $this->argument('apps')),
        static fn (string $app): bool => $app !== '',
    ));

    try {
        $results = $runner->seed($username, $apps === [] ? null : $apps, $profile, (bool) $this->option('force'));
    } catch (RuntimeException $e) {
        $this->error($e->getMessage());

        return self::FAILURE;
    }

    foreach ($results as $result) {
        $extra = '';
        if (isset($result['extra']) && is_array($result['extra'])) {
            foreach ($result['extra'] as $key => $value) {
                $extra .= sprintf(', %s %d', $key, $value);
            }
        }
        $this->info(sprintf(
            'Seeded %s for %s (%s): created %d, skipped %d, deleted %d%s.',
            $result['app'],
            $username,
            $profile,
            $result['created'],
            $result['skipped'],
            $result['deleted'],
            $extra,
        ));
    }

    $this->info(sprintf('Dev seed complete [%s].', (string) config('database.connections.wgw.database')));

    return self::SUCCESS;
})->purpose('Shared local-dev seeder: calendars + notes (pass app names to limit; --force recreates)');

Artisan::command('wgw:jmap:filenodes-reindex', function (JmapFileNodeIndexService $index): int {
    $result = $index->reindexAll();
    $this->info(sprintf(
        'Indexed %d new node(s); tombstoned %d vanished node(s); pruned %d stale tombstone(s).',
        $result['indexed'],
        $result['tombstoned'],
        $result['pruned'],
    ));

    return self::SUCCESS;
})->purpose('Backfill/reconcile the JMAP FileNode index against the drive (existing node ids are kept)');

Artisan::command('wgw:meet:sweep-reservations', function (MeetReservationService $reservations): int {
    $deleted = $reservations->sweepExpiredNeverActivated();
    $this->info(sprintf('Deleted %d never-activated expired Meet reservation(s).', $deleted));

    return self::SUCCESS;
})->purpose('Prune never-activated Meet reservations whose expiresAt is past (null expiry is skipped)');

Artisan::command('wgw:jmap:blobs-gc', function (JmapBlobGarbageCollector $collector): int {
    $result = $collector->collect();
    $this->info(sprintf(
        'Deleted %d expired blob(s); retained %d referenced blob(s).',
        $result['deleted'],
        $result['retained'],
    ));

    return self::SUCCESS;
})->purpose('Delete expired, unreferenced JMAP envelope blobs (domain references are never collected)');
