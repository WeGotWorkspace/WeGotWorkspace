<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Where and when a user approved an assistant on the consent page: one row per
 * user and OAuth client, replaced on each new approval. Settings → AI
 * assistants shows it ("Approved via Safari on Mac, Nov 12"). Only the browser
 * user agent and the time are kept, no IP address.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('mcp_consents')) {
            return;
        }
        $this->wgw()->create('mcp_consents', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 191);
            $table->string('client_id', 100);
            $table->string('user_agent', 512)->nullable();
            $table->timestamp('approved_at');
            $table->unique(['username', 'client_id']);
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('mcp_consents');
    }
};
