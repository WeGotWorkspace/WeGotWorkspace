<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('drive_starred_items')) {
            return;
        }

        $indexes = collect($this->wgw()->getIndexes('drive_starred_items'))->pluck('name')->all();
        if (in_array('idx_drive_starred_path', $indexes, true)) {
            return;
        }

        $this->wgw()->table('drive_starred_items', function (Blueprint $table): void {
            // varchar(512) utf8mb4 is 2048 bytes, under InnoDB's 3072-byte index limit.
            $table->index('path', 'idx_drive_starred_path');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('drive_starred_items')) {
            return;
        }

        $indexes = collect($this->wgw()->getIndexes('drive_starred_items'))->pluck('name')->all();
        if (! in_array('idx_drive_starred_path', $indexes, true)) {
            return;
        }

        $this->wgw()->table('drive_starred_items', function (Blueprint $table): void {
            $table->dropIndex('idx_drive_starred_path');
        });
    }
};
