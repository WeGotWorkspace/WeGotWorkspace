<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Change markers for the JMAP event source (#1660, docs/architecture/jmap-push.md).
 *
 * `jmap_file_node_root_markers`: one counter per Drive root (account root
 * `users/x` / `groups/y`, or a share root). Every Drive write bumps the roots
 * its storage key falls under. `root_hash` is the SHA-256 of `root_key`, so the
 * unique index is exact (no case folding) and stays under the MySQL key limit.
 *
 * `notification_markers`: one counter per principal. Create, supersede,
 * clear and read of a `notifications` row bump it. Clear deletes the row, so
 * a column on `notifications` itself could not record it.
 *
 * A missing row counts as 0 in both tables.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('jmap_file_node_root_markers')) {
            $this->wgw()->create('jmap_file_node_root_markers', function (Blueprint $table): void {
                $table->id();
                $table->char('root_hash', 64)->unique();
                $table->string('root_key', 1024);
                $table->unsignedBigInteger('marker')->default(0);
            });
        }

        if (! $this->wgwHasTable('notification_markers')) {
            $this->wgw()->create('notification_markers', function (Blueprint $table): void {
                $table->id();
                $table->string('principal', 255)->unique();
                $table->unsignedBigInteger('marker')->default(0);
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_file_node_root_markers');
        $this->wgw()->dropIfExists('notification_markers');
    }
};
