<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * How many uploads produced a blob (#1500). Ids are content-addressed, so a
 * second upload of the same bytes (another device, a finished assembly) gets
 * the same row; an attach moves the bytes away only while one upload holds
 * the id, and copies otherwise.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_blobs') && ! $this->wgwHasColumn('jmap_blobs', 'upload_count')) {
            $this->wgw()->table('jmap_blobs', function (Blueprint $table): void {
                $table->unsignedInteger('upload_count')->default(1);
            });
        }
    }

    public function down(): void
    {
        if ($this->wgwHasTable('jmap_blobs') && $this->wgwHasColumn('jmap_blobs', 'upload_count')) {
            $this->wgw()->table('jmap_blobs', function (Blueprint $table): void {
                $table->dropColumn('upload_count');
            });
        }
    }
};
