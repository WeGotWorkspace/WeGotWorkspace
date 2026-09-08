<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('oauth_clients')) {
            $this->wgw()->create('oauth_clients', function (Blueprint $table): void {
                $table->uuid('id')->primary();
                $table->nullableMorphs('owner');
                $table->string('name');
                $table->string('secret')->nullable();
                $table->string('provider')->nullable();
                $table->text('redirect_uris');
                $table->text('grant_types');
                $table->text('scopes')->nullable();
                $table->boolean('revoked')->default(false);
                $table->string('cimd_url', 2048)->nullable();
                $table->string('cimd_origin', 255)->nullable();
                $table->timestamp('cimd_fetched_at')->nullable();
                $table->timestamps();
                $table->unique('cimd_url');
            });
        }

        if (! $this->wgwHasTable('oauth_auth_codes')) {
            $this->wgw()->create('oauth_auth_codes', function (Blueprint $table): void {
                $table->char('id', 80)->primary();
                $table->unsignedBigInteger('user_id')->index();
                $table->uuid('client_id');
                $table->text('scopes')->nullable();
                $table->boolean('revoked');
                $table->dateTime('expires_at')->nullable();
            });
        }

        if (! $this->wgwHasTable('oauth_access_tokens')) {
            $this->wgw()->create('oauth_access_tokens', function (Blueprint $table): void {
                $table->char('id', 80)->primary();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->uuid('client_id');
                $table->string('name')->nullable();
                $table->text('scopes')->nullable();
                $table->boolean('revoked');
                $table->timestamps();
                $table->dateTime('expires_at')->nullable();
            });
        }

        if (! $this->wgwHasTable('oauth_refresh_tokens')) {
            $this->wgw()->create('oauth_refresh_tokens', function (Blueprint $table): void {
                $table->char('id', 80)->primary();
                $table->char('access_token_id', 80)->index();
                $table->boolean('revoked');
                $table->dateTime('expires_at')->nullable();
            });
        }

        if (! $this->wgwHasTable('oauth_device_codes')) {
            $this->wgw()->create('oauth_device_codes', function (Blueprint $table): void {
                $table->char('id', 80)->primary();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->uuid('client_id')->index();
                $table->char('user_code', 8)->unique();
                $table->text('scopes');
                $table->boolean('revoked');
                $table->dateTime('user_approved_at')->nullable();
                $table->dateTime('last_polled_at')->nullable();
                $table->dateTime('expires_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('oauth_device_codes');
        $this->wgw()->dropIfExists('oauth_refresh_tokens');
        $this->wgw()->dropIfExists('oauth_access_tokens');
        $this->wgw()->dropIfExists('oauth_auth_codes');
        $this->wgw()->dropIfExists('oauth_clients');
    }
};
