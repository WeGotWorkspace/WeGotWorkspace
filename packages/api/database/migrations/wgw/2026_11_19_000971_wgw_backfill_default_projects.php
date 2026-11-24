<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Projects\DefaultProjectProvisioner;

/**
 * Every existing Team gets its default Project (#817): the provisioned calendar, task
 * list and notebook plus one new channel, named "{Team name} Project". Find-or-create,
 * so running it twice changes nothing.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('projects') || ! $this->wgwHasTable('principals')) {
            return;
        }

        app(DefaultProjectProvisioner::class)->ensureForAllTeams();
    }

    public function down(): void
    {
        // Data migration: the default Projects stay; dropping `projects` removes them.
    }
};
