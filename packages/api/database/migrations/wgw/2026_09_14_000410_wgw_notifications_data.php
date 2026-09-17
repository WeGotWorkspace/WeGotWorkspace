<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('notifications') || $this->wgwHasColumn('notifications', 'data')) {
            return;
        }

        $this->wgw()->table('notifications', function (Blueprint $table): void {
            // Structured notification facts (actor, path, snippet, start/end, …).
            // Display title/body are formatted at the edge when this is present.
            $table->json('data')->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('notifications') || ! $this->wgwHasColumn('notifications', 'data')) {
            return;
        }

        $this->wgw()->table('notifications', function (Blueprint $table): void {
            $table->dropColumn('data');
        });
    }
};
