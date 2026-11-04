<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Folder download tickets (#1621): the #1500 ticket rules (hashed secret,
 * one account, the issuing session's refresh-token family, sliding idle
 * expiry capped by an absolute lifetime), bound to a folder's node id.
 * A table of their own, so file and folder secrets never redeem each other.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('drive_folder_download_tickets')) {
            return;
        }

        $this->wgw()->create('drive_folder_download_tickets', function (Blueprint $table): void {
            $table->id();
            $table->char('secret_hash', 64)->unique();
            $table->string('username', 255);
            $table->string('node_id', 64);
            $table->string('zip_name', 255);
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
        $this->wgw()->dropIfExists('drive_folder_download_tickets');
    }
};
