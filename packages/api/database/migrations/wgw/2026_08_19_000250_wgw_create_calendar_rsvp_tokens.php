<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_rsvp_tokens')) {
            if ($this->wgwHasColumn('calendar_rsvp_tokens', 'token')) {
                // Unreleased plaintext rows cannot be kept: wipe and recreate hashed.
                $this->wgw()->drop('calendar_rsvp_tokens');
            } else {
                return;
            }
        }

        $this->wgw()->create('calendar_rsvp_tokens', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('token_hash', 64)->unique();
            $table->string('event_uid', 255);
            $table->string('attendee_email', 255);
            $table->string('organizer_username', 255);
            $table->integer('expires_at');
            $table->string('used_partstat', 32)->nullable();
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_rsvp_tokens');
    }
};
