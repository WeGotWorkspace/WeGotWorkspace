<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Projects\DefaultProjectProvisioner;

/**
 * Every default Project gets its Drive folder (#817 A2/A3), like any other Project: a
 * top-level folder in the Team Drive, registered as its `drive_folder` resource. Files
 * already in the Team Drive root stay where they are. Find-or-create, so running it
 * twice changes nothing.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('projects') || ! $this->wgwHasTable('project_resources') || ! $this->wgwHasTable('principals')) {
            return;
        }

        // Also finds the default Projects that already exist and only lack the folder.
        app(DefaultProjectProvisioner::class)->ensureForAllTeams();
    }

    public function down(): void
    {
        // Data migration: the folders stay; they are ordinary Drive folders.
    }
};
