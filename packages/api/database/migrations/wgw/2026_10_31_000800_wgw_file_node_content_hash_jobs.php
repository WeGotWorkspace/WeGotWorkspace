<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * One meaning for content_sha256 (#1500): files discovered on disk whose
 * hash is still pending, the resumable hash jobs for them, and staged
 * attach copies that span more than one step.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_file_nodes') && ! $this->wgwHasColumn('jmap_file_nodes', 'hash_pending')) {
            $this->wgw()->table('jmap_file_nodes', function (Blueprint $table): void {
                $table->boolean('hash_pending')->default(false)->index();
            });
        }

        if ($this->wgwHasTable('jmap_blobs') && ! $this->wgwHasColumn('jmap_blobs', 'in_use_until')) {
            $this->wgw()->table('jmap_blobs', function (Blueprint $table): void {
                // Set while an attach streams a copy of the blob, so a
                // concurrent attach copies too instead of moving the file away.
                $table->timestamp('in_use_until')->nullable();
            });
        }

        if (! $this->wgwHasTable('jmap_content_hash_jobs')) {
            $this->wgw()->create('jmap_content_hash_jobs', function (Blueprint $table): void {
                $table->id();
                $table->string('node_id', 64)->unique();
                // size:mtime the job started from; a change restarts the job.
                $table->string('basis', 64);
                $table->unsignedBigInteger('hashed_bytes')->default(0);
                $table->text('hash_state')->nullable();
                $table->string('hash_build', 128)->nullable();
                $table->timestamp('locked_until')->nullable();
                $table->timestamps();
            });
        }

        if (! $this->wgwHasTable('jmap_attach_staging')) {
            $this->wgw()->create('jmap_attach_staging', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->string('blob_id', 64);
                // sha256 of the target storage key (the key itself can exceed
                // an indexable length on MySQL).
                $table->char('target_hash', 64);
                $table->string('target_key', 1024);
                $table->string('staging_key', 255);
                $table->unsignedBigInteger('size_bytes');
                $table->unsignedBigInteger('copied_bytes')->default(0);
                $table->timestamps();

                $table->unique(['username', 'blob_id', 'target_hash']);
                $table->index(['username', 'blob_id']);
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_attach_staging');
        $this->wgw()->dropIfExists('jmap_content_hash_jobs');
        if ($this->wgwHasTable('jmap_blobs') && $this->wgwHasColumn('jmap_blobs', 'in_use_until')) {
            $this->wgw()->table('jmap_blobs', function (Blueprint $table): void {
                $table->dropColumn('in_use_until');
            });
        }
        if ($this->wgwHasTable('jmap_file_nodes') && $this->wgwHasColumn('jmap_file_nodes', 'hash_pending')) {
            $this->wgw()->table('jmap_file_nodes', function (Blueprint $table): void {
                $table->dropIndex(['hash_pending']);
                $table->dropColumn('hash_pending');
            });
        }
    }
};
