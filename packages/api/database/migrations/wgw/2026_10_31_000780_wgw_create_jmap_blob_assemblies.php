<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Blob assembly extension (#1500, https://wegotworkspace.org/jmap/blob-assembly):
 * one row per assembly, one row per accepted part, and part claims an open
 * assembly holds on uploaded parts it has not appended yet.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('jmap_blob_assemblies')) {
            $this->wgw()->create('jmap_blob_assemblies', function (Blueprint $table): void {
                $table->id();
                $table->string('assembly_id', 64)->unique();
                $table->string('username', 255);
                $table->string('media_type', 255)->nullable();
                // Declared total length of the assembled blob.
                $table->unsignedBigInteger('size_bytes');
                $table->unsignedBigInteger('received_bytes')->default(0);
                $table->unsignedInteger('next_index')->default(0);
                // Running sha256: serialized HashContext covering the first
                // hashed_bytes octets, written by the build in hash_build.
                $table->unsignedBigInteger('hashed_bytes')->default(0);
                $table->text('hash_state')->nullable();
                $table->string('hash_build', 128)->nullable();
                // Stored before the blob is committed, so a retried finish
                // never finalizes a HashContext twice.
                $table->char('final_sha256', 64)->nullable();
                $table->string('blob_id', 64)->nullable();
                $table->string('status', 16)->default('open');
                // Lease that serializes calls on one assembly without holding
                // a transaction open during I/O.
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('expires_at');
                $table->timestamps();

                $table->index(['username', 'status']);
                $table->index('expires_at');
            });
        }

        if (! $this->wgwHasTable('jmap_blob_assembly_parts')) {
            $this->wgw()->create('jmap_blob_assembly_parts', function (Blueprint $table): void {
                $table->id();
                $table->string('assembly_id', 64);
                $table->unsignedInteger('part_index');
                $table->string('blob_id', 64);
                $table->unsignedBigInteger('size_bytes');
                $table->timestamps();

                $table->unique(['assembly_id', 'part_index']);
            });
        }

        if (! $this->wgwHasTable('jmap_blob_claims')) {
            $this->wgw()->create('jmap_blob_claims', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->string('blob_id', 64);
                $table->string('assembly_id', 64);
                $table->timestamps();

                $table->unique(['assembly_id', 'blob_id']);
                $table->index(['username', 'blob_id']);
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_blob_claims');
        $this->wgw()->dropIfExists('jmap_blob_assembly_parts');
        $this->wgw()->dropIfExists('jmap_blob_assemblies');
    }
};
