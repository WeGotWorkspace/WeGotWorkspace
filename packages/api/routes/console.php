<?php

use App\Services\Calendars\DefaultCalendarColorMigrator;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Contacts\GroupMemberUriBackfill;
use App\Services\Installer\DevInstallBootstrap;
use App\Services\Installer\InstallerJwtKeyGenerator;
use App\Services\Installer\ProductionInstallBootstrap;
use App\Services\Installer\WgwConfigMigrator;
use App\Services\Installer\WgwSchemaMigrator;
use App\Services\Jmap\Blobs\JmapBlobGarbageCollector;
use App\Services\Jmap\FileNodes\FileNodeIndexService as JmapFileNodeIndexService;
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
})->purpose('Provision home/work VEVENT calendars, tasks-home/tasks-work/tasks-inbox VTODO lists, and group VEVENT + VTODO calendars (idempotent)');

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

Artisan::command('wgw:jmap:blobs-gc', function (JmapBlobGarbageCollector $collector): int {
    $result = $collector->collect();
    $this->info(sprintf(
        'Deleted %d expired blob(s); retained %d referenced blob(s).',
        $result['deleted'],
        $result['retained'],
    ));

    return self::SUCCESS;
})->purpose('Delete expired, unreferenced JMAP envelope blobs (domain references are never collected)');
