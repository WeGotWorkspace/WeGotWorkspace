<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('notifications')) {
            $this->wgw()->create('notifications', function (Blueprint $table): void {
                $table->string('id', 26)->primary();
                $table->string('principal', 255);
                $table->string('event_id', 255);
                $table->string('domain', 64);
                $table->string('action', 64);
                $table->string('title', 255);
                $table->text('body')->nullable();
                $table->string('navigate', 1024);
                $table->string('tag', 255)->nullable();
                $table->string('dedupe_key', 255);
                $table->timestamp('read_at')->nullable();
                $table->timestamp('created_at');

                $table->unique(['principal', 'dedupe_key']);
                $table->index(['principal', 'created_at']);
                $table->index(['principal', 'read_at']);
            });
        }

        if (! $this->wgwHasTable('notification_deliveries')) {
            $this->wgw()->create('notification_deliveries', function (Blueprint $table): void {
                $table->string('id', 26)->primary();
                $table->string('notification_id', 26);
                $table->string('principal', 255);
                $table->string('channel', 16);
                $table->timestamp('due_at');
                $table->timestamp('acked_at')->nullable();
                $table->timestamp('sent_at')->nullable();
                $table->timestamp('created_at');

                $table->index(['channel', 'due_at', 'acked_at']);
                $table->index('notification_id');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('notification_deliveries');
        $this->wgw()->dropIfExists('notifications');
    }
};
