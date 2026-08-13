<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_blobs')) {
            return;
        }

        $this->wgw()->create('jmap_blobs', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 255);
            $table->string('blob_id', 64);
            $table->string('media_type', 255)->nullable();
            $table->unsignedBigInteger('size_bytes');
            $table->char('sha256', 64);
            // Unreferenced blobs expire; the GC honours domain reference
            // checkers (a blob referenced by a domain object never expires).
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->unique(['username', 'blob_id']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_blobs');
    }
};
