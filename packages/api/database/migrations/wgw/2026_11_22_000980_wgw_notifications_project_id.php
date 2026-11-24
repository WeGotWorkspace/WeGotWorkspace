<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('notifications') || $this->wgwHasColumn('notifications', 'project_id')) {
            return;
        }

        $this->wgw()->table('notifications', function (Blueprint $table): void {
            // The Project of the notification's subject (#810); null for DMs, personal
            // items and rows from before this column.
            $table->string('project_id', 26)->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('notifications') || ! $this->wgwHasColumn('notifications', 'project_id')) {
            return;
        }

        $this->wgw()->table('notifications', function (Blueprint $table): void {
            $table->dropColumn('project_id');
        });
    }
};
