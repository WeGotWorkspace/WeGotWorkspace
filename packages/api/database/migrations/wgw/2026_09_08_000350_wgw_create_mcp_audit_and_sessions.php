<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('mcp_audit_events')) {
            $this->wgw()->create('mcp_audit_events', function (Blueprint $table): void {
                $table->id();
                $table->string('event_type', 64);
                $table->string('username', 255)->nullable();
                $table->string('client_id', 255)->nullable();
                $table->string('client_name', 255)->nullable();
                $table->string('tool', 128)->nullable();
                $table->string('access', 16)->nullable();
                $table->string('outcome', 32);
                $table->text('target')->nullable();
                $table->timestamp('created_at');
                $table->index(['username', 'created_at']);
                $table->index(['client_id', 'created_at']);
            });
        }

        if (! $this->wgwHasTable('mcp_sessions')) {
            $this->wgw()->create('mcp_sessions', function (Blueprint $table): void {
                $table->string('id', 128)->primary();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->string('client_id', 255)->nullable();
                $table->timestamp('created_at');
                $table->timestamp('last_seen_at');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('mcp_sessions');
        $this->wgw()->dropIfExists('mcp_audit_events');
    }
};
