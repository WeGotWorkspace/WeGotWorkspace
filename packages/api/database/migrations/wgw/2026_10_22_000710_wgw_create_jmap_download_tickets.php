<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Download tickets (#1500): a hashed secret bound to one blob, one account,
 * and the refresh-token family of the issuing session, with a sliding idle
 * expiry capped by an absolute lifetime.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_download_tickets')) {
            return;
        }

        $this->wgw()->create('jmap_download_tickets', function (Blueprint $table): void {
            $table->id();
            $table->char('secret_hash', 64)->unique();
            $table->string('username', 255);
            $table->string('blob_id', 128);
            $table->string('file_name', 255);
            $table->string('media_type', 255)->nullable();
            $table->string('session_family', 64);
            $table->timestamp('issued_at');
            $table->timestamp('last_seen_at');
            $table->timestamp('absolute_expires_at');
            $table->timestamps();

            $table->index('username');
            $table->index('absolute_expires_at');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_download_tickets');
    }
};
