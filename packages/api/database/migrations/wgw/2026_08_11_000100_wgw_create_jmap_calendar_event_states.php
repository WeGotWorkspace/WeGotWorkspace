<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_calendar_event_states')) {
            return;
        }

        $this->wgw()->create('jmap_calendar_event_states', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 255);
            $table->string('event_id', 255);
            $table->string('calendar_uri', 255);
            $table->string('object_uri', 255);
            $table->string('state_token', 64);
            $table->string('etag', 255)->nullable();
            $table->timestamps();

            $table->unique(['username', 'event_id']);
            $table->unique('state_token');
            $table->index(['username', 'calendar_uri']);
            $table->index(['username', 'object_uri']);
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_calendar_event_states');
    }
};
