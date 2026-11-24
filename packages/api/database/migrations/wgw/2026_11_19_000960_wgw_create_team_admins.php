<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Team admins (#2278): which members run a Team. One row per Team and user.
 *
 * A table of its own, not a column on `groupmembers`: member writes go through
 * Sabre's group-member-set, which deletes and re-inserts those rows. Existing
 * Teams get no row: an organization admin appoints the first team admin.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('team_admins')) {
            return;
        }

        $this->wgw()->create('team_admins', function (Blueprint $table): void {
            $table->id();
            $table->string('group_slug', 64);
            $table->string('username', 64);
            $table->unique(['group_slug', 'username']);
            $table->index('username');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('team_admins');
    }
};
