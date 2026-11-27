<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Public availability link (#2405). One row per person who has the link on;
 * no row means off. `token_hash` is the SHA-256 lookup key of the public URL,
 * `token_cipher` the encrypted token so the owner can see the link again.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_availability_links')) {
            return;
        }

        $this->wgw()->create('calendar_availability_links', function (Blueprint $table): void {
            $table->string('principal_uri', 255)->primary();
            $table->string('token_hash', 64)->unique();
            $table->text('token_cipher');
            $table->timestamp('created_at', 6);
            $table->timestamp('rotated_at', 6)->nullable();
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_availability_links');
    }
};
