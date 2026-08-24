<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_subscriptions')) {
            return;
        }

        $this->wgw()->create('calendar_subscriptions', function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('username', 255);
            $table->string('calendar_uri', 255);
            $table->text('url');
            $table->string('name', 255)->nullable();
            $table->string('color', 32)->nullable();
            $table->timestamp('last_fetched_at')->nullable();

            $table->unique(['username', 'calendar_uri']);
            $table->index('username');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_subscriptions');
    }
};
