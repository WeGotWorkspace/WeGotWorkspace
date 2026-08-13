<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('jmap_file_nodes')) {
            $this->wgw()->create('jmap_file_nodes', function (Blueprint $table): void {
                $table->id();
                // Stable FileNode id (fn- + uuid): survives rename/move.
                $table->string('node_id', 64)->unique();
                // Current storage key; unique among live rows (tombstones may
                // share a key with a later re-creation).
                $table->string('storage_key', 1024);
                $table->string('parent_node_id', 64)->nullable()->index();
                $table->string('name', 255);
                $table->boolean('is_dir');
                $table->unsignedBigInteger('size_bytes')->nullable();
                $table->char('content_sha256', 64)->nullable();
                // Global monotonic change sequence (jmap_file_node_meta.seq):
                // created_seq pins the creation point, change_seq the latest
                // mutation — FileNode/changes splits created/updated on them.
                $table->unsignedBigInteger('created_seq');
                $table->unsignedBigInteger('change_seq')->index();
                // Tombstone: destroyed nodes keep their row so /changes can
                // report them; pruned after a retention window.
                $table->timestamp('deleted_at')->nullable();
                $table->timestamps();

                $table->index(['storage_key', 'deleted_at']);
            });
        }

        if (! $this->wgwHasTable('jmap_file_node_meta')) {
            $this->wgw()->create('jmap_file_node_meta', function (Blueprint $table): void {
                $table->id();
                // Single row: the global sequence counter and the highest
                // pruned tombstone seq (sinceState below it → cannotCalculateChanges).
                $table->unsignedBigInteger('seq')->default(0);
                $table->unsignedBigInteger('pruned_seq')->default(0);
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_file_nodes');
        $this->wgw()->dropIfExists('jmap_file_node_meta');
    }
};
