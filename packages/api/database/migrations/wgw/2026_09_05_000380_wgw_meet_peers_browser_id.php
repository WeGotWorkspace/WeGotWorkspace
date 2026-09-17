<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('meet_peers') || $this->wgwHasColumn('meet_peers', 'browser_id')) {
            return;
        }

        // Same-browser leftover peers (reload / second tab) share this
        // client-generated token. Join evicts other rows in the room with the
        // same browser_id so one device does not appear twice; a second
        // device has its own token and stays. Collab/principal tables never
        // use the column — they already collapse same-owner leftovers.
        $this->wgw()->table('meet_peers', function (Blueprint $table): void {
            $table->string('browser_id', 32)->default('');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('meet_peers') || ! $this->wgwHasColumn('meet_peers', 'browser_id')) {
            return;
        }

        $this->wgw()->table('meet_peers', function (Blueprint $table): void {
            $table->dropColumn('browser_id');
        });
    }
};
