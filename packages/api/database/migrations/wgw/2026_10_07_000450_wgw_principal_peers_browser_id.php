<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Principal presence peers share the meet/collab browser token so a reload
 * (and React StrictMode's second mount) evicts the leftover row immediately.
 * A second device has its own token and stays.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('principal_peers') || $this->wgwHasColumn('principal_peers', 'browser_id')) {
            return;
        }

        $this->wgw()->table('principal_peers', function (Blueprint $table): void {
            $table->string('browser_id', 32)->default('');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('principal_peers') || ! $this->wgwHasColumn('principal_peers', 'browser_id')) {
            return;
        }

        $this->wgw()->table('principal_peers', function (Blueprint $table): void {
            $table->dropColumn('browser_id');
        });
    }
};
