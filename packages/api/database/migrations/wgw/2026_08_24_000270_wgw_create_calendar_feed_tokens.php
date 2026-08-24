<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_feed_tokens')) {
            return;
        }

        $this->wgw()->create('calendar_feed_tokens', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('token_hash', 64)->unique();
            // Encrypted raw token (APP_KEY) so the owner feed URL can be re-shown.
            // Not hash-only like calendar_rsvp_tokens; compromised APP_KEY recovers issued URLs.
            $table->text('token_cipher');
            $table->string('owner_username', 255);
            $table->string('calendar_uri', 255);

            $table->unique(['owner_username', 'calendar_uri']);
            $table->index('owner_username');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_feed_tokens');
    }
};
