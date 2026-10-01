<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('drive_starred_items')) {
            return;
        }

        $this->wgw()->create('drive_starred_items', function (Blueprint $table): void {
            $table->string('username', 190);
            // 512 keeps (username, path) composite PK under MySQL utf8mb4 index limit (3072 bytes).
            $table->string('path', 512);
            $table->unsignedBigInteger('created_at');
            $table->primary(['username', 'path']);
            $table->index('username', 'idx_drive_starred_user');
            // Full path index: prefix rewrite is `path = ? OR path LIKE 'prefix/%'`.
            // varchar(512) utf8mb4 is 2048 bytes, under the 3072-byte InnoDB limit
            // (same as drive_shares.path). A 191-char prefix would miss longer paths.
            $table->index('path', 'idx_drive_starred_path');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('drive_starred_items');
    }
};
