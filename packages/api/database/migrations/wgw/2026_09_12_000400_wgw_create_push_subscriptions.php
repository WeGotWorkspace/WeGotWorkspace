<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('push_subscriptions')) {
            return;
        }

        $this->wgw()->create('push_subscriptions', function (Blueprint $table): void {
            $table->string('id', 26)->primary();
            $table->string('principal', 255);
            $table->text('endpoint');
            $table->string('endpoint_hash', 64);
            $table->string('p256dh', 255);
            $table->string('auth', 255);
            $table->string('user_agent', 512)->nullable();
            $table->timestamp('created_at');
            $table->timestamp('updated_at')->nullable();

            $table->unique(['principal', 'endpoint_hash']);
            $table->index('principal');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('push_subscriptions');
    }
};
