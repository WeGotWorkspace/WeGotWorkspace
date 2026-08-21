<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('api_password_reset_tokens')) {
            return;
        }

        $this->wgw()->create('api_password_reset_tokens', function (Blueprint $table): void {
            $table->string('token_hash', 128)->primary();
            $table->string('username', 190);
            $table->unsignedBigInteger('expires_at');
            $table->index('username', 'idx_api_password_reset_username');
            $table->index('expires_at', 'idx_api_password_reset_expires');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('api_password_reset_tokens');
    }
};
